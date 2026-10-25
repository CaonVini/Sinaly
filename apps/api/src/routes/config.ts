import { count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  categoryCreateSchema,
  categoryPatchSchema,
  orderSchema,
  slugify,
  statusCreateSchema,
  statusPatchSchema,
} from "@sinaly/shared";
import { db } from "../db/client.js";
import { isUniqueViolation } from "../db/errors.js";
import { appSettings, categories, configAudit, occurrences, statuses, users } from "../db/schema.js";
import type { GeocodeQueue } from "../geocode.js";
import { HttpError, limitConfig, parse } from "../http.js";
import { getMeta, invalidateMeta } from "../meta.js";
import { geocoderSetting, invalidateSettings } from "../settings.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Entity = "category" | "status";

const audit = (tx: Tx, req: FastifyRequest, entity: Entity, entityKey: string, action: string, changes: Record<string, unknown>) =>
  tx.insert(configAudit).values({ actorId: req.auth.userId, entity, entityKey, action, changes, ip: req.ip });

/** Só campos que realmente mudaram (a auditoria registra de → para). */
function diff(cur: Record<string, unknown>, next: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== cur[k]) out[k] = { from: cur[k], to: v };
  return out;
}

function rethrowDuplicate(message: string) {
  return (e: unknown): never => {
    if (isUniqueViolation(e)) throw new HttpError(409, message);
    throw e;
  };
}

async function freeSlug(tx: Tx, entity: Entity, base: string): Promise<string> {
  const table = entity === "category" ? categories : statuses;
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 36)}_${i + 1}`;
    const [hit] = await tx.select({ slug: table.slug }).from(table).where(eq(table.slug, candidate));
    if (!hit) return candidate;
  }
  throw new HttpError(409, "Não foi possível gerar um identificador; escolha outro nome.");
}

export async function configRoutes(app: FastifyInstance, opts: { rateLimit: boolean; geocode: GeocodeQueue }) {
  const gestorOnly = app.requireRole("gestor");
  const rl = (max: number) => limitConfig(opts.rateLimit, max, "1 minute");
  const slugParam = (req: FastifyRequest) => (req.params as { slug: string }).slug;

  async function reorder(req: FastifyRequest, entity: Entity) {
    const { slugs } = parse(orderSchema, req.body);
    if (new Set(slugs).size !== slugs.length) throw new HttpError(400, "Lista com itens repetidos");
    const table = entity === "category" ? categories : statuses;
    await db.transaction(async (tx) => {
      const existing = (await tx.select({ slug: table.slug }).from(table).for("update")).map((r) => r.slug);
      // Exige a lista completa: evita ordens parciais ambíguas.
      if (existing.length !== slugs.length || !slugs.every((s) => existing.includes(s))) throw new HttpError(400, "Envie todos os itens na nova ordem");
      // Uma só instrução em vez de N consultas.
      await tx.execute(
        sql`update ${table} t set sort = v.ord from (select s, (ord - 1)::int as ord from unnest(array[${sql.join(slugs.map((x) => sql`${x}`), sql`, `)}]::text[]) with ordinality as x(s, ord)) v where t.slug = v.s`,
      );
      await audit(tx, req, entity, "order", "reorder", { order: { to: slugs } });
    });
    invalidateMeta();
  }

  // Público: o app e o painel precisam dos nomes/cores/ícones para desenhar o mapa e os filtros.
  app.get("/meta", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=10");
    return (await getMeta()).meta;
  });

  // ---------- categorias ----------
  app.post("/staff/config/categories", { preHandler: gestorOnly, ...rl(30) }, async (req, reply) => {
    const body = parse(categoryCreateSchema, req.body);
    const created = await db
      .transaction(async (tx) => {
        const slug = await freeSlug(tx, "category", slugify(body.name));
        const [m] = await tx.select({ max: sql<number>`coalesce(max(${categories.sort}), -1)` }).from(categories);
        const [row] = await tx.insert(categories).values({ slug, ...body, sort: Number(m?.max ?? -1) + 1 }).returning();
        await audit(tx, req, "category", slug, "create", { name: { to: body.name }, color: { to: body.color }, icon: { to: body.icon } });
        return row!;
      })
      .catch(rethrowDuplicate("Já existe uma categoria com esse nome"));
    invalidateMeta();
    return reply.code(201).send(created);
  });

  app.patch("/staff/config/categories/:slug", { preHandler: gestorOnly, ...rl(60) }, async (req) => {
    const slug = slugParam(req);
    const body = parse(categoryPatchSchema, req.body);
    const updated = await db
      .transaction(async (tx) => {
        const [cur] = await tx.select().from(categories).where(eq(categories.slug, slug)).for("update");
        if (!cur) throw new HttpError(404, "Categoria não encontrada");
        const changes = diff(cur, body);
        if (Object.keys(changes).length === 0) return cur;
        const [row] = await tx.update(categories).set(body).where(eq(categories.slug, slug)).returning();
        await audit(tx, req, "category", slug, "update", changes);
        return row!;
      })
      .catch(rethrowDuplicate("Já existe uma categoria com esse nome"));
    invalidateMeta();
    return updated;
  });

  app.delete("/staff/config/categories/:slug", { preHandler: gestorOnly, ...rl(30) }, async (req, reply) => {
    const slug = slugParam(req);
    await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(categories).where(eq(categories.slug, slug)).for("update");
      if (!cur) throw new HttpError(404, "Categoria não encontrada");
      if (cur.system) throw new HttpError(409, "Categoria do sistema não pode ser excluída; desative-a.");
      const [used] = await tx.select({ n: count() }).from(occurrences).where(eq(occurrences.category, slug));
      if ((used?.n ?? 0) > 0) throw new HttpError(409, `Há ${used!.n} ocorrência(s) nessa categoria; desative-a em vez de excluir.`);
      await tx.delete(categories).where(eq(categories.slug, slug));
      await audit(tx, req, "category", slug, "delete", { name: { from: cur.name, to: null } });
    });
    invalidateMeta();
    return reply.code(204).send();
  });

  app.put("/staff/config/categories-order", { preHandler: gestorOnly, ...rl(30) }, async (req, reply) => {
    await reorder(req, "category");
    return reply.code(204).send();
  });

  // ---------- status ----------
  app.post("/staff/config/statuses", { preHandler: gestorOnly, ...rl(30) }, async (req, reply) => {
    const body = parse(statusCreateSchema, req.body);
    const created = await db
      .transaction(async (tx) => {
        const slug = await freeSlug(tx, "status", slugify(body.name));
        const [m] = await tx.select({ max: sql<number>`coalesce(max(${statuses.sort}), -1)` }).from(statuses);
        // Status criados pela prefeitura são sempre "em andamento" (visíveis no mapa), nunca o primeiro estágio.
        const [row] = await tx.insert(statuses).values({ slug, ...body, kind: "active", isEntry: false, sort: Number(m?.max ?? -1) + 1 }).returning();
        await audit(tx, req, "status", slug, "create", { name: { to: body.name }, color: { to: body.color }, kind: { to: "active" } });
        return row!;
      })
      .catch(rethrowDuplicate("Já existe um status com esse nome"));
    invalidateMeta();
    return reply.code(201).send(created);
  });

  app.patch("/staff/config/statuses/:slug", { preHandler: gestorOnly, ...rl(60) }, async (req) => {
    const slug = slugParam(req);
    const body = parse(statusPatchSchema, req.body);
    const updated = await db
      .transaction(async (tx) => {
        const [cur] = await tx.select().from(statuses).where(eq(statuses.slug, slug)).for("update");
        if (!cur) throw new HttpError(404, "Status não encontrado");
        // Os 5 status do sistema sustentam as regras (fluxo, regra dos 5 dias): podem ser renomeados e recoloridos, nunca desativados.
        if (cur.system && body.active === false) throw new HttpError(409, "Status do sistema não pode ser desativado.");
        const changes = diff(cur, body);
        if (Object.keys(changes).length === 0) return cur;
        const [row] = await tx.update(statuses).set(body).where(eq(statuses.slug, slug)).returning();
        await audit(tx, req, "status", slug, "update", changes);
        return row!;
      })
      .catch(rethrowDuplicate("Já existe um status com esse nome"));
    invalidateMeta();
    return updated;
  });

  app.delete("/staff/config/statuses/:slug", { preHandler: gestorOnly, ...rl(30) }, async (req, reply) => {
    const slug = slugParam(req);
    await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(statuses).where(eq(statuses.slug, slug)).for("update");
      if (!cur) throw new HttpError(404, "Status não encontrado");
      if (cur.system) throw new HttpError(409, "Status do sistema não pode ser excluído.");
      // Histórico e notificações também referenciam o status (FK): excluir só se nunca foi usado.
      const used = await tx.execute(sql`select (
          (select count(*) from occurrences where status = ${slug})
        + (select count(*) from status_history where from_status = ${slug} or to_status = ${slug})
        + (select count(*) from notifications where from_status = ${slug} or to_status = ${slug}))::int as n`);
      if (((used.rows[0] as { n: number } | undefined)?.n ?? 0) > 0) throw new HttpError(409, "Esse status já foi usado; desative-o em vez de excluir.");
      await tx.delete(statuses).where(eq(statuses.slug, slug));
      await audit(tx, req, "status", slug, "delete", { name: { from: cur.name, to: null } });
    });
    invalidateMeta();
    return reply.code(204).send();
  });

  app.put("/staff/config/statuses-order", { preHandler: gestorOnly, ...rl(30) }, async (req, reply) => {
    await reorder(req, "status");
    return reply.code(204).send();
  });

  // ---------- auditoria da configuração ----------
  app.get("/staff/config/audit", { preHandler: gestorOnly }, async () => {
    const rows = await db
      .select({
        id: configAudit.id,
        entity: configAudit.entity,
        entityKey: configAudit.entityKey,
        action: configAudit.action,
        changes: configAudit.changes,
        actorName: users.name,
        at: configAudit.createdAt,
      })
      .from(configAudit)
      .innerJoin(users, eq(users.id, configAudit.actorId))
      .orderBy(desc(configAudit.id))
      .limit(50);
    return { items: rows };
  });

  // ---------- bairro automático ----------
  app.get("/staff/geocode/status", { preHandler: gestorOnly }, async () => ({
    available: opts.geocode.enabled, // servidor configurado (GEOCODER_ENABLED)
    enabled: opts.geocode.enabled && (await geocoderSetting()), // e ligado pelo gestor
    missing: await opts.geocode.missing(),
    ...opts.geocode.stats(),
  }));

  // Liga/desliga o preenchimento automático. Persistido, auditado, vale na hora.
  app.put("/staff/config/geocoder", { preHandler: gestorOnly, ...rl(30) }, async (req) => {
    const { enabled } = parse(z.object({ enabled: z.boolean() }).strict(), req.body);
    const before = await geocoderSetting();
    if (before !== enabled) {
      await db.transaction(async (tx) => {
        await tx.insert(appSettings).values({ key: "geocoder_enabled", value: enabled }).onConflictDoUpdate({ target: appSettings.key, set: { value: enabled, updatedAt: new Date() } });
        await tx.insert(configAudit).values({ actorId: req.auth.userId, entity: "setting", entityKey: "geocoder_enabled", action: "update", changes: { enabled: { from: before, to: enabled } }, ip: req.ip });
      });
      invalidateSettings();
      if (!enabled) opts.geocode.clear();
    }
    return { enabled };
  });

  // Enfileira até 200 ocorrências sem bairro por chamada (as mais novas primeiro).
  app.post("/staff/geocode/backfill", { preHandler: gestorOnly, ...rl(5) }, async () => {
    if (!opts.geocode.enabled) throw new HttpError(409, "Bairro automático indisponível no servidor (GEOCODER_ENABLED).");
    if (!(await geocoderSetting())) throw new HttpError(409, "Bairro automático está desligado. Ligue-o em Configuração.");
    return opts.geocode.backfill(200);
  });
}
