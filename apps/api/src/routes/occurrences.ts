import multipart from "@fastify/multipart";
import { and, count, desc, eq, gt, inArray, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ALLOWED_TRANSITIONS,
  CATEGORY_LABELS,
  PUBLIC_STATUSES,
  RESOLVED_VISIBLE_DAYS,
  STATUS_LABELS,
  createOccurrenceFieldsSchema,
  listQuerySchema,
  mapQuerySchema,
  staffCreateFieldsSchema,
  staffUpdateSchema,
  type Category,
  type Source,
  type Status,
} from "@sinaly/shared";
import { discardPhoto, ImageError, storePhoto } from "../images.js";
import type { Auth } from "../auth.js";
import { db } from "../db/client.js";
import { citizenProfiles, notifications, occurrenceAudit, occurrences, statusHistory, users } from "../db/schema.js";
import { decodeCursor, encodeCursor, HttpError, limitConfig, parse, UUID_RE } from "../http.js";
import { decrypt, encrypt } from "../security/crypto.js";
import { openObject, thumbKey } from "../storage.js";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const DAILY_CAP = 20; // ocorrências por cidadão em 24 h (anti-spam)
const FIELD_NAMES = new Set(["category", "description", "lat", "lng", "status", "reporterName", "reporterPhone"]);

const columns = {
  id: occurrences.id,
  category: occurrences.category,
  description: occurrences.description,
  status: occurrences.status,
  hasPhoto: sql<boolean>`${occurrences.photoKey} is not null`,
  lat: sql<number>`ST_Y(${occurrences.location})`,
  lng: sql<number>`ST_X(${occurrences.location})`,
  createdAt: occurrences.createdAt,
  updatedAt: occurrences.updatedAt,
  resolvedAt: occurrences.resolvedAt,
  cursorTs: sql<string>`to_char(${occurrences.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};
type Row = {
  id: string;
  category: Category;
  description: string;
  status: Status;
  hasPhoto: boolean;
  lat: number;
  lng: number;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  cursorTs: string;
};

// Lista explícita de campos: nada de authorId, photoKey ou cursorTs vaza para quem não deve.
const dto = (r: Row) => ({
  id: r.id,
  category: r.category,
  description: r.description,
  status: r.status,
  lat: r.lat,
  lng: r.lng,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  resolvedAt: r.resolvedAt,
  photoUrl: r.hasPhoto ? `/occurrences/${r.id}/photo` : null,
  thumbUrl: r.hasPhoto ? `/occurrences/${r.id}/photo?size=thumb` : null,
});

const isStaff = (a: Auth | null): boolean => !!a && a.role !== "cidadao";
const isPublic = (status: Status) => PUBLIC_STATUSES.includes(status);
// Cidadão só vê o que é público ou o que é seu; funcionário vê tudo.
const canSee = (a: Auth | null, row: { status: Status; authorId: string }) =>
  isPublic(row.status) || isStaff(a) || (!!a && a.userId === row.authorId);

/** Visível no mapa: em análise/atendimento sempre; resolvido só nos primeiros N dias (ou com o filtro "resolvidos"). */
function publicWhere(includeResolved: boolean): SQL {
  if (includeResolved) return inArray(occurrences.status, [...PUBLIC_STATUSES]);
  return or(
    inArray(occurrences.status, ["em_analise", "em_atendimento"]),
    and(eq(occurrences.status, "resolvido"), gt(occurrences.resolvedAt, sql`now() - make_interval(days => ${RESOLVED_VISIBLE_DAYS})`)),
  )!;
}

const inBbox = (b: { minLng: number; minLat: number; maxLng: number; maxLat: number }) =>
  sql`${occurrences.location} && ST_MakeEnvelope(${b.minLng}, ${b.minLat}, ${b.maxLng}, ${b.maxLat}, 4326)`;

async function fetchOne(id: string, tx: Pick<typeof db, "select"> = db, lock = false) {
  const q = tx
    .select({ ...columns, authorId: occurrences.authorId, photoKey: occurrences.photoKey, source: occurrences.source, contactEnc: occurrences.reporterContactEnc })
    .from(occurrences)
    .where(eq(occurrences.id, id))
    .limit(1);
  const [row] = await (lock ? q.for("update") : q);
  return row as (Row & { authorId: string; photoKey: string | null; source: Source; contactEnc: string | null }) | undefined;
}

async function page(where: SQL | undefined, limit: number, cursor: string | undefined) {
  const c = decodeCursor(cursor);
  const after = c ? sql`(${occurrences.createdAt}, ${occurrences.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined;
  const rows = (await db
    .select({ ...columns, authorId: occurrences.authorId, authorName: users.name, source: occurrences.source, contactEnc: occurrences.reporterContactEnc })
    .from(occurrences)
    .leftJoin(users, eq(users.id, occurrences.authorId))
    .where(and(where, after))
    .orderBy(desc(occurrences.createdAt), desc(occurrences.id))
    .limit(limit + 1)) as (Row & { authorId: string; authorName: string | null; source: Source; contactEnc: string | null })[];
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.cursorTs, last.id) : null };
}

/** Contato de quem ligou (cifrado em repouso). Só é devolvido a funcionários. */
function contactOf(enc: string | null): { name: string | null; phone: string | null } | null {
  if (!enc) return null;
  try {
    const c = JSON.parse(decrypt(enc)) as { name?: string; phone?: string };
    return { name: c.name ?? null, phone: c.phone ?? null };
  } catch {
    return null;
  }
}

const staffExtras = (r: { source: Source; contactEnc: string | null }) => ({ source: r.source, contact: contactOf(r.contactEnc) });

/** Período de criação em dias no horário de Brasília (from inclusivo, to inclusivo). */
function createdBetween(from?: string, to?: string): SQL | undefined {
  const tz = "America/Sao_Paulo";
  return and(
    from ? sql`${occurrences.createdAt} >= (${from}::date)::timestamp at time zone ${tz}` : undefined,
    to ? sql`${occurrences.createdAt} < ((${to}::date + 1)::timestamp at time zone ${tz})` : undefined,
  );
}

async function readMultipart(req: FastifyRequest): Promise<{ fields: Record<string, string>; file: Buffer | null }> {
  if (!req.isMultipart()) throw new HttpError(415, "Envie como multipart/form-data");
  const fields: Record<string, string> = {};
  let file: Buffer | null = null;
  for await (const part of req.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "photo") {
        part.file.resume();
        throw new HttpError(400, "Campo de arquivo inesperado (use 'photo')");
      }
      const buf = await part.toBuffer(); // lança 413 se passar do limite
      file = buf.length > 0 ? buf : null;
    } else if (FIELD_NAMES.has(part.fieldname) && typeof part.value === "string") {
      fields[part.fieldname] = part.value;
    }
  }
  return { fields, file };
}

async function photoOrThrow(file: Buffer): Promise<string> {
  try {
    return await storePhoto(file);
  } catch (e) {
    if (e instanceof ImageError) throw new HttpError(400, e.message);
    throw e;
  }
}

const idParam = (req: FastifyRequest) => {
  const id = (req.params as { id?: string }).id;
  if (!id || !UUID_RE.test(id)) throw new HttpError(404, "Ocorrência não encontrada");
  return id;
};

export async function occurrenceRoutes(app: FastifyInstance, opts: { rateLimit: boolean }) {
  const rl = (max: number, window: string) => limitConfig(opts.rateLimit, max, window);
  await app.register(multipart, { limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 8, fieldSize: 4096, parts: 10 } });
  const staffOnly = app.requireRole("servidor", "gestor");

  // ---------- cidadão: registrar ----------
  app.post("/occurrences", { preHandler: app.requireRole("cidadao"), ...rl(20, "1 hour") }, async (req, reply) => {
    const { fields, file } = await readMultipart(req);
    const data = parse(createOccurrenceFieldsSchema, fields);
    const authorId = req.auth.userId;

    const [profile] = await db.select({ id: citizenProfiles.userId }).from(citizenProfiles).where(eq(citizenProfiles.userId, authorId));
    if (!profile) throw new HttpError(403, "Conclua o onboarding antes de registrar ocorrências");
    const [recent] = await db
      .select({ n: count() })
      .from(occurrences)
      .where(and(eq(occurrences.authorId, authorId), gt(occurrences.createdAt, sql`now() - interval '24 hours'`)));
    if ((recent?.n ?? 0) >= DAILY_CAP) throw new HttpError(429, "Limite diário de ocorrências atingido");

    const photoKey = file ? await photoOrThrow(file) : null;
    try {
      const id = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(occurrences)
          .values({
            authorId,
            category: data.category,
            description: data.description,
            location: sql`ST_SetSRID(ST_MakePoint(${data.lng}, ${data.lat}), 4326)` as unknown as { x: number; y: number },
            photoKey,
          })
          .returning({ id: occurrences.id });
        const occurrenceId = created!.id;
        await tx.insert(statusHistory).values({ occurrenceId, fromStatus: null, toStatus: "nao_verificado", changedBy: authorId });
        await tx.insert(occurrenceAudit).values({
          occurrenceId,
          actorId: authorId,
          actorRole: "cidadao",
          action: "create",
          changes: { category: { to: data.category }, description: { to: data.description }, location: { to: { lat: data.lat, lng: data.lng } }, photo: { to: photoKey } },
          ip: req.ip,
        });
        return occurrenceId;
      });
      return reply.code(201).send(dto((await fetchOne(id))!));
    } catch (e) {
      await discardPhoto(photoKey);
      throw e;
    }
  });

  // ---------- mapa público ----------
  app.get("/occurrences/map", rl(120, "1 minute"), async (req, reply) => {
    const q = parse(mapQuerySchema, req.query);
    const rows = (await db
      .select(columns)
      .from(occurrences)
      .where(and(publicWhere(q.includeResolved), q.category ? eq(occurrences.category, q.category) : undefined, inBbox(q.bbox)))
      .orderBy(desc(occurrences.createdAt))
      .limit(q.limit + 1)) as Row[];
    reply.header("Cache-Control", "public, max-age=10");
    return { items: rows.slice(0, q.limit).map(dto), truncated: rows.length > q.limit };
  });

  // ---------- detalhe e foto ----------
  app.get("/occurrences/:id", async (req, reply) => {
    const id = idParam(req);
    const auth = await app.tryAuth(req);
    const row = await fetchOne(id);
    if (!row || !canSee(auth, row)) throw new HttpError(404, "Ocorrência não encontrada"); // 404, não 403: não revela que existe
    const body: Record<string, unknown> = dto(row);
    if (isStaff(auth)) Object.assign(body, staffExtras(row));
    if (isStaff(auth) || auth?.userId === row.authorId) {
      const history = await db
        .select({ from: statusHistory.fromStatus, to: statusHistory.toStatus, note: statusHistory.note, at: statusHistory.createdAt })
        .from(statusHistory)
        .where(eq(statusHistory.occurrenceId, id))
        .orderBy(statusHistory.createdAt, statusHistory.id);
      body.history = history;
    }
    reply.header("Cache-Control", "private, no-cache");
    return body;
  });

  app.get("/occurrences/:id/photo", async (req: FastifyRequest, reply: FastifyReply) => {
    const id = idParam(req);
    const auth = await app.tryAuth(req);
    const row = await fetchOne(id);
    if (!row || !row.photoKey || !canSee(auth, row)) throw new HttpError(404, "Foto não encontrada");
    const thumb = (req.query as { size?: string }).size === "thumb";
    let file;
    try {
      file = await openObject(thumb ? thumbKey(row.photoKey) : row.photoKey);
    } catch {
      throw new HttpError(404, "Foto não encontrada");
    }
    const open = isPublic(row.status);
    return reply
      .header("Content-Type", "image/jpeg")
      .header("Content-Length", file.size)
      // Foto pública pode ser exibida em <img> de outra origem e cacheada; a privada nunca.
      .header("Cache-Control", open ? "public, max-age=300" : "private, no-store")
      .header("Cross-Origin-Resource-Policy", open ? "cross-origin" : "same-origin")
      .send(file.stream);
  });

  // ---------- cidadão: as próprias ----------
  app.get("/me/occurrences", { preHandler: app.requireRole("cidadao") }, async (req) => {
    const q = parse(listQuerySchema, req.query);
    const { items, nextCursor } = await page(
      and(eq(occurrences.authorId, req.auth.userId), q.status ? eq(occurrences.status, q.status) : undefined),
      q.limit,
      q.cursor,
    );
    return { items: items.map(dto), nextCursor };
  });

  // ---------- prefeitura ----------
  app.get("/staff/occurrences", { preHandler: staffOnly }, async (req) => {
    const q = parse(listQuerySchema, req.query);
    const { items, nextCursor } = await page(
      and(
        q.status ? eq(occurrences.status, q.status) : undefined,
        q.category ? eq(occurrences.category, q.category) : undefined,
        q.bbox ? inBbox(q.bbox) : undefined,
        createdBetween(q.from, q.to),
      ),
      q.limit,
      q.cursor,
    );
    return { items: items.map((r) => ({ ...dto(r), authorId: r.authorId, authorName: r.authorName, ...staffExtras(r) })), nextCursor };
  });

  // Cadastro manual (ex.: ligação por telefone). Foto opcional; entra já visível ao cidadão conforme o status escolhido.
  app.post("/staff/occurrences", { preHandler: staffOnly, ...rl(60, "1 minute") }, async (req, reply) => {
    const { fields, file } = await readMultipart(req);
    const data = parse(staffCreateFieldsSchema, fields);
    const actor = req.auth;
    const contact = data.reporterName || data.reporterPhone ? encrypt(JSON.stringify({ name: data.reporterName ?? null, phone: data.reporterPhone ?? null })) : null;

    const photoKey = file ? await photoOrThrow(file) : null;
    try {
      const id = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(occurrences)
          .values({
            authorId: actor.userId,
            category: data.category,
            description: data.description,
            location: sql`ST_SetSRID(ST_MakePoint(${data.lng}, ${data.lat}), 4326)` as unknown as { x: number; y: number },
            photoKey,
            status: data.status,
            source: "prefeitura",
            reporterContactEnc: contact,
          })
          .returning({ id: occurrences.id });
        const occurrenceId = created!.id;
        await tx.insert(statusHistory).values({ occurrenceId, fromStatus: null, toStatus: data.status, changedBy: actor.userId });
        await tx.insert(occurrenceAudit).values({
          occurrenceId,
          actorId: actor.userId,
          actorRole: actor.role,
          action: "create",
          // O contato não vai para a auditoria em texto aberto: só registramos que existe.
          changes: {
            source: { to: "prefeitura" },
            status: { to: data.status },
            category: { to: data.category },
            description: { to: data.description },
            location: { to: { lat: data.lat, lng: data.lng } },
            photo: { to: photoKey },
            ...(contact ? { reporterContact: { to: "informado" } } : {}),
          },
          ip: req.ip,
        });
        return occurrenceId;
      });
      const row = (await fetchOne(id))!;
      return reply.code(201).send({ ...dto(row), authorId: row.authorId, ...staffExtras(row) });
    } catch (e) {
      await discardPhoto(photoKey);
      throw e;
    }
  });

  app.patch("/staff/occurrences/:id", { preHandler: staffOnly, ...rl(60, "1 minute") }, async (req) => {
    const id = idParam(req);
    const body = parse(staffUpdateSchema, req.body);
    const actor = req.auth;

    return db.transaction(async (tx) => {
      const cur = await fetchOne(id, tx, true); // trava a linha: duas edições simultâneas não se atropelam
      if (!cur) throw new HttpError(404, "Ocorrência não encontrada");

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (body.category && body.category !== cur.category) changes.category = { from: cur.category, to: body.category };
      if (body.description && body.description !== cur.description) changes.description = { from: cur.description, to: body.description };
      if (body.lat !== undefined && body.lng !== undefined && (Math.abs(body.lat - cur.lat) > 1e-7 || Math.abs(body.lng - cur.lng) > 1e-7)) {
        changes.location = { from: { lat: cur.lat, lng: cur.lng }, to: { lat: body.lat, lng: body.lng } };
      }
      const newStatus = body.status && body.status !== cur.status ? body.status : null;
      if (newStatus) {
        if (!ALLOWED_TRANSITIONS[cur.status].includes(newStatus)) {
          throw new HttpError(409, `Transição inválida: ${STATUS_LABELS[cur.status]} → ${STATUS_LABELS[newStatus]}`);
        }
        if (newStatus === "recusado" && !body.note) throw new HttpError(400, "Informe o motivo da recusa em 'note'");
        changes.status = { from: cur.status, to: newStatus };
        if (body.note) changes.note = { from: null, to: body.note };
      } else if (body.note) {
        throw new HttpError(400, "A nota só vale junto com uma mudança de status");
      }
      if (Object.keys(changes).length === 0) return { changed: false, ...dto(cur) };

      await tx
        .update(occurrences)
        .set({
          updatedAt: new Date(),
          ...(changes.category ? { category: body.category } : {}),
          ...(changes.description ? { description: body.description } : {}),
          ...(changes.location ? { location: sql`ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)` as unknown as { x: number; y: number } } : {}),
          ...(newStatus ? { status: newStatus, resolvedAt: newStatus === "resolvido" ? sql`now()` : cur.status === "resolvido" ? null : undefined } : {}),
        })
        .where(eq(occurrences.id, id));

      if (newStatus) {
        await tx.insert(statusHistory).values({ occurrenceId: id, fromStatus: cur.status, toStatus: newStatus, changedBy: actor.userId, note: body.note ?? null });
        const snippet = cur.description.length > 60 ? `${cur.description.slice(0, 60)}…` : cur.description;
        await tx.insert(notifications).values({
          userId: cur.authorId,
          occurrenceId: id,
          type: "status_changed",
          title: "Sua ocorrência foi atualizada",
          body:
            `${CATEGORY_LABELS[cur.category]} "${snippet}": ${STATUS_LABELS[cur.status]} → ${STATUS_LABELS[newStatus]}.` +
            (body.note ? ` Mensagem da prefeitura: ${body.note}` : ""),
          fromStatus: cur.status,
          toStatus: newStatus,
        });
      }
      await tx.insert(occurrenceAudit).values({
        occurrenceId: id,
        actorId: actor.userId,
        actorRole: actor.role,
        action: Object.keys(changes).every((k) => k === "status" || k === "note") ? "status_change" : "update",
        changes,
        ip: req.ip,
      });
      return { changed: true, ...dto((await fetchOne(id, tx))!) };
    });
  });

  app.put("/staff/occurrences/:id/photo", { preHandler: staffOnly, ...rl(30, "1 minute") }, async (req) => {
    const id = idParam(req);
    const { file } = await readMultipart(req);
    if (!file) throw new HttpError(400, "Envie a imagem no campo 'photo'");
    const newKey = await photoOrThrow(file);
    try {
      const oldKey = await db.transaction(async (tx) => {
        const cur = await fetchOne(id, tx, true);
        if (!cur) throw new HttpError(404, "Ocorrência não encontrada");
        await tx.update(occurrences).set({ photoKey: newKey, updatedAt: new Date() }).where(eq(occurrences.id, id));
        await tx.insert(occurrenceAudit).values({
          occurrenceId: id,
          actorId: req.auth.userId,
          actorRole: req.auth.role,
          action: "photo_replace",
          changes: { photo: { from: cur.photoKey, to: newKey } },
          ip: req.ip,
        });
        return cur.photoKey;
      });
      await discardPhoto(oldKey); // só depois do commit
      return { changed: true, ...dto((await fetchOne(id))!) };
    } catch (e) {
      await discardPhoto(newKey);
      throw e;
    }
  });

  // Números para o painel: contagem por status/categoria, tempo médio até resolver e criadas por dia.
  app.get("/staff/stats", { preHandler: staffOnly }, async () => {
    const [byStatus, byCategory, resolution, perDay] = await Promise.all([
      db.select({ key: occurrences.status, total: count() }).from(occurrences).groupBy(occurrences.status),
      db.select({ key: occurrences.category, total: count() }).from(occurrences).groupBy(occurrences.category),
      db.execute(sql`select avg(extract(epoch from (resolved_at - created_at)) / 3600)::float8 as hours
        from occurrences where status = 'resolvido' and resolved_at is not null`),
      db.execute(sql`select to_char(d::date, 'YYYY-MM-DD') as day, coalesce(c.total, 0)::int as total
        from generate_series(current_date - 13, current_date, interval '1 day') d
        left join (select created_at::date as day, count(*) as total from occurrences
                   where created_at >= current_date - 13 group by 1) c on c.day = d::date
        order by d`),
    ]);
    const hours = (resolution.rows[0] as { hours: number | null } | undefined)?.hours ?? null;
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.key, r.total])),
      byCategory: Object.fromEntries(byCategory.map((r) => [r.key, r.total])),
      avgResolutionHours: hours === null ? null : Math.round(hours * 10) / 10,
      perDay: perDay.rows as { day: string; total: number }[],
    };
  });

  app.get("/staff/occurrences/:id/audit", { preHandler: staffOnly }, async (req) => {
    const id = idParam(req);
    const rows = await db
      .select({
        id: occurrenceAudit.id,
        action: occurrenceAudit.action,
        actorId: occurrenceAudit.actorId,
        actorName: users.name,
        actorRole: occurrenceAudit.actorRole,
        changes: occurrenceAudit.changes,
        ip: occurrenceAudit.ip,
        at: occurrenceAudit.createdAt,
      })
      .from(occurrenceAudit)
      .innerJoin(users, eq(users.id, occurrenceAudit.actorId))
      .where(eq(occurrenceAudit.occurrenceId, id))
      .orderBy(occurrenceAudit.id);
    return { items: rows };
  });
}
