import { and, eq, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { db } from "./db/client.js";
import { occurrenceAudit, occurrences, users } from "./db/schema.js";
import { env } from "./env.js";

/** Devolve o bairro de um ponto, ou null se não achou. Nunca lança para o chamador decidir: erros viram null. */
export type ReverseGeocoder = (lat: number, lng: number) => Promise<string | null>;

const MIN_GAP_MS = 1_100; // política do Nominatim público: no máximo 1 requisição por segundo
const MAX_QUEUE = 1_000;

/** Nominatim (OpenStreetMap). Só latitude/longitude saem do servidor; nenhum dado pessoal. */
export const nominatim: ReverseGeocoder = async (lat, lng) => {
  const url = new URL("/reverse", env.GEOCODER_URL);
  url.search = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lng), zoom: "16", addressdetails: "1", "accept-language": "pt-BR" }).toString();
  const res = await fetch(url, { headers: { "User-Agent": env.GEOCODER_USER_AGENT }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return null;
  const body = (await res.json()) as { address?: Record<string, string> };
  const a = body.address ?? {};
  const name = a.suburb ?? a.neighbourhood ?? a.city_district ?? a.quarter ?? a.village ?? null;
  return name && name.length >= 2 ? name.slice(0, 80) : null;
};

/**
 * Fila em memória que preenche o bairro das ocorrências sem bairro, uma por vez e respeitando o intervalo mínimo.
 * Melhor esforço: se o serviço falhar, a ocorrência continua sem bairro e pode ser reprocessada pelo gestor.
 */
export function createGeocodeQueue(geocode: ReverseGeocoder | null, log: FastifyBaseLogger, gapMs = MIN_GAP_MS) {
  const pending = new Set<string>();
  let running: Promise<void> | null = null;

  async function fill(id: string) {
    const [row] = await db
      .select({ lat: occurrences.location, authorId: occurrences.authorId })
      .from(occurrences)
      .where(and(eq(occurrences.id, id), isNull(occurrences.neighborhood)));
    if (!row || !geocode) return;
    const { x: lng, y: lat } = row.lat;
    const name = await geocode(lat, lng);
    if (!name) return;
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
    });
  }

  async function drain() {
    while (pending.size > 0) {
      const id = pending.values().next().value as string;
      pending.delete(id);
      try {
        await fill(id);
      } catch (err) {
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
    async idle() {
      while (running) await running;
    },
    size: () => pending.size,
  };
}
export type GeocodeQueue = ReturnType<typeof createGeocodeQueue>;
