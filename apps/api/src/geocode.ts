import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { db } from "./db/client.js";
import { occurrenceAudit, occurrences, users } from "./db/schema.js";
import { env } from "./env.js";
import { geocoderSetting } from "./settings.js";

/** Devolve o bairro de um ponto, ou null se não achou. Nunca lança para o chamador decidir: erros viram null. */
export type ReverseGeocoder = (lat: number, lng: number) => Promise<string | null>;

const MIN_GAP_MS = 1_100; // política do Nominatim público: no máximo 1 requisição por segundo
const MAX_QUEUE = 1_000;

/** Nominatim (OpenStreetMap). Só latitude/longitude saem do servidor; nenhum dado pessoal. */
export const nominatim: ReverseGeocoder = async (lat, lng) => {
  const url = new URL("/reverse", env.GEOCODER_URL);
  url.search = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lng), zoom: "16", addressdetails: "1", "accept-language": "pt-BR" }).toString();
  const res = await fetch(url, { headers: { "User-Agent": env.GEOCODER_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  // Falha de serviço (403 UA bloqueado, 429 limite, 5xx) lança: a fila registra o motivo em vez de fingir que "não achou".
  if (!res.ok) throw new Error(`geocoder respondeu HTTP ${res.status}`);
  const body = (await res.json()) as { address?: Record<string, string> };
  const a = body.address ?? {};
  const name = a.suburb ?? a.neighbourhood ?? a.city_district ?? a.quarter ?? a.borough ?? a.village ?? a.hamlet ?? null;
  return name && name.length >= 2 ? name.slice(0, 80) : null;
};

/**
 * Fila em memória que preenche o bairro das ocorrências sem bairro, uma por vez e respeitando o intervalo mínimo.
 * Melhor esforço: se o serviço falhar, a ocorrência continua sem bairro e pode ser reprocessada pelo gestor.
 */
export function createGeocodeQueue(geocode: ReverseGeocoder | null, log: FastifyBaseLogger, gapMs = MIN_GAP_MS) {
  const pending = new Set<string>();
  let running: Promise<void> | null = null;
  const stats = { filled: 0, notFound: 0, failed: 0, lastError: null as string | null, lastErrorAt: null as string | null, lastFilledAt: null as string | null };

  async function fill(id: string) {
    // O gestor pode desligar a qualquer momento: vale na hora, inclusive para o que já estava na fila.
    if (!(await geocoderSetting())) return;
    const [row] = await db
      .select({ lat: occurrences.location, authorId: occurrences.authorId })
      .from(occurrences)
      .where(and(eq(occurrences.id, id), isNull(occurrences.neighborhood)));
    if (!row || !geocode) return;
    const { x: lng, y: lat } = row.lat;
    const name = await geocode(lat, lng);
    if (!name) {
      stats.notFound++; // o serviço respondeu, mas não há bairro naquele ponto
      return;
    }
    await db.transaction(async (tx) => {
      // A condição "ainda sem bairro" evita sobrescrever um bairro que alguém digitou enquanto a fila andava.
      const updated = await tx
        .update(occurrences)
        .set({ neighborhood: name })
        .where(and(eq(occurrences.id, id), isNull(occurrences.neighborhood)))
        .returning({ id: occurrences.id });
      if (updated.length === 0) return;
      const [author] = await tx.select({ role: users.role }).from(users).where(eq(users.id, row.authorId));
      // Auditoria: ação distinta e marcada como automática (o "ator" é o autor do registro, não uma pessoa agindo agora).
      await tx.insert(occurrenceAudit).values({
        occurrenceId: id,
        actorId: row.authorId,
        actorRole: author?.role ?? "cidadao",
        action: "geocode_auto",
        changes: { neighborhood: { from: null, to: name, auto: true } },
        ip: null,
      });
      stats.filled++;
      stats.lastFilledAt = new Date().toISOString();
    });
  }

  async function drain() {
    while (pending.size > 0) {
      const id = pending.values().next().value as string;
      pending.delete(id);
      try {
        await fill(id);
      } catch (err) {
        stats.failed++;
        stats.lastError = err instanceof Error ? `${err.message}${err.cause ? ` (${String((err.cause as Error).message ?? err.cause)})` : ""}` : String(err);
        stats.lastErrorAt = new Date().toISOString();
        log.warn({ err, id }, "geocodificação falhou");
      }
      if (pending.size > 0) await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  return {
    enabled: geocode !== null,
    /** Agenda e retorna na hora; devolve false se a fila estiver cheia ou o serviço desligado. */
    enqueue(id: string): boolean {
      if (!geocode || pending.size >= MAX_QUEUE) return false;
      pending.add(id);
      running ??= drain().finally(() => (running = null));
      return true;
    },
    /** Espera a fila esvaziar (usado nos testes e no desligamento). */
    /** Descarta a fila (usado ao desligar). */
    clear() {
      pending.clear();
    },
    async idle() {
      while (running) await running;
    },
    size: () => pending.size,
    stats: () => ({ ...stats, pending: pending.size }),
    /** Enfileira ocorrências sem bairro (mais novas primeiro). Devolve quantas entraram e quantas ainda faltam. */
    async backfill(limit = 200) {
      if (!geocode || !(await geocoderSetting())) return { queued: 0, remaining: await this.missing() };
      const rows = await db.select({ id: occurrences.id }).from(occurrences).where(isNull(occurrences.neighborhood)).orderBy(desc(occurrences.createdAt)).limit(limit);
      let queued = 0;
      for (const r of rows) if (this.enqueue(r.id)) queued++;
      const [total] = await db.select({ n: count() }).from(occurrences).where(isNull(occurrences.neighborhood));
      return { queued, remaining: Math.max(0, (total?.n ?? 0) - queued) };
    },
    async missing() {
      const [total] = await db.select({ n: count() }).from(occurrences).where(isNull(occurrences.neighborhood));
      return total?.n ?? 0;
    },
  };
}
export type GeocodeQueue = ReturnType<typeof createGeocodeQueue>;
