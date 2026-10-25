import multipart from "@fastify/multipart";
import { and, asc, count, desc, eq, gt, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  RESOLVED_VISIBLE_DAYS,
  canTransition,
  createOccurrenceFieldsSchema,
  exportAuditSchema,
  listQuerySchema,
  reverseGeocodeQuerySchema,
  mapQuerySchema,
  activityQuerySchema,
  isInsideArea,
  staffCreateFieldsSchema,
  staffUpdateSchema,
  type Category,
  type Source,
  type Status,
  type StatusMeta,
} from "@sinaly/shared";
import { discardPhoto, ImageError, storePhoto } from "../images.js";
import type { Auth } from "../auth.js";
import { db } from "../db/client.js";
import { citizenProfiles, notifications, occurrenceAudit, occurrences, statusHistory, statuses, users } from "../db/schema.js";
import type { GeocodeQueue } from "../geocode.js";
import { decodeCursor, encodeCursor, HttpError, limitConfig, parse, UUID_RE } from "../http.js";
import { getMeta } from "../meta.js";
import { auditAccess } from "../access-audit.js";
import { decrypt, encrypt } from "../security/crypto.js";
import { serviceArea } from "../settings.js";
import { openObject, thumbKey } from "../storage.js";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const DAILY_CAP = 20; // ocorrências por cidadão em 24 h (anti-spam)
const FIELD_NAMES = new Set(["category", "description", "neighborhood", "lat", "lng", "status", "reporterName", "reporterPhone"]);

const columns = {
  id: occurrences.id,
  category: occurrences.category,
  description: occurrences.description,
  neighborhood: occurrences.neighborhood,
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
  neighborhood: string | null;
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
  neighborhood: r.neighborhood,
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
// Quem decide se um status é público é o TIPO dele (active/resolved), não o nome: status criados pela prefeitura valem igual.
type StatusMap = Map<string, StatusMeta>;
const isPublic = (st: StatusMap, status: Status) => {
  const k = st.get(status)?.kind;
  return k === "active" || k === "resolved";
};
// Cidadão só vê o que é público ou o que é seu; funcionário vê tudo.
const canSee = (st: StatusMap, a: Auth | null, row: { status: Status; authorId: string }) =>
  isPublic(st, row.status) || isStaff(a) || (!!a && a.userId === row.authorId);

const slugsOfKind = (...kinds: StatusMeta["kind"][]) =>
  sql`(select ${statuses.slug} from ${statuses} where ${statuses.kind} in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)}))`;

/** Visível no mapa: status "em andamento" sempre; resolvido só nos primeiros N dias (ou com o filtro "resolvidos"). */
function publicWhere(includeResolved: boolean): SQL {
  if (includeResolved) return sql`${occurrences.status} in ${slugsOfKind("active", "resolved")}`;
  return or(
    sql`${occurrences.status} in ${slugsOfKind("active")}`,
    and(sql`${occurrences.status} in ${slugsOfKind("resolved")}`, gt(occurrences.resolvedAt, sql`now() - make_interval(days => ${RESOLVED_VISIBLE_DAYS})`)),
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

async function page(where: SQL | undefined, limit: number, cursor: string | undefined, order: "asc" | "desc" = "desc") {
  const c = decodeCursor(cursor);
  const after = c
    ? order === "desc"
      ? sql`(${occurrences.createdAt}, ${occurrences.id}) < (${c.t}::timestamptz, ${c.id}::uuid)`
      : sql`(${occurrences.createdAt}, ${occurrences.id}) > (${c.t}::timestamptz, ${c.id}::uuid)`
    : undefined;
  const dir = order === "desc" ? desc : asc;
  const rows = (await db
    .select({ ...columns, authorId: occurrences.authorId, authorName: users.name, source: occurrences.source, contactEnc: occurrences.reporterContactEnc })
    .from(occurrences)
    .leftJoin(users, eq(users.id, occurrences.authorId))
    .where(and(where, after))
    .orderBy(dir(occurrences.createdAt), dir(occurrences.id))
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

/** Recusa pontos fora da área de atuação configurada pelo admin (a trava do mapa no cliente não basta). */
async function assertInArea(lat: number, lng: number) {
  const area = await serviceArea();
  if (!isInsideArea(area, lat, lng)) throw new HttpError(400, `O local fica fora da área atendida (${area!.name}).`, { location: [`Fora da área atendida (${area!.name})`] });
}

const idParam = (req: FastifyRequest) => {
  const id = (req.params as { id?: string }).id;
  if (!id || !UUID_RE.test(id)) throw new HttpError(404, "Ocorrência não encontrada");
  return id;
};

export async function occurrenceRoutes(app: FastifyInstance, opts: { rateLimit: boolean; geocode: GeocodeQueue }) {
  const rl = (max: number, window: string) => limitConfig(opts.rateLimit, max, window);
  await app.register(multipart, { limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 10, fieldSize: 4096, parts: 12 } });
  const staffOnly = app.requireRole("servidor", "gestor", "admin");

  // ---------- cidadão: registrar ----------
  app.post("/occurrences", { preHandler: app.requireRole("cidadao"), ...rl(20, "1 hour") }, async (req, reply) => {
    const { fields, file } = await readMultipart(req);
    const data = parse(createOccurrenceFieldsSchema, fields);
    await assertInArea(data.lat, data.lng);
    const authorId = req.auth.userId;
    const { cat } = await getMeta();
    if (!cat.get(data.category)?.active) throw new HttpError(400, "Dados inválidos", { category: ["Categoria inválida"] });

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
            neighborhood: data.neighborhood ?? null,
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
          changes: { category: { to: data.category }, description: { to: data.description }, ...(data.neighborhood ? { neighborhood: { to: data.neighborhood } } : {}), location: { to: { lat: data.lat, lng: data.lng } }, photo: { to: photoKey } },
          ip: req.ip,
        });
        return occurrenceId;
      });
      if (!data.neighborhood) opts.geocode.enqueue(id);
      return reply.code(201).send(dto((await fetchOne(id))!));
    } catch (e) {
      await discardPhoto(photoKey);
      throw e;
    }
  });

  // ---------- cidadão: bairro do ponto marcado ----------
  // O app nunca fala direto com o geocodificador: passa por aqui para respeitar o liga/desliga do gestor,
  // o ritmo de 1 consulta/s do serviço e não expor o IP do cidadão a terceiros.
  app.get("/geocode/reverse", { preHandler: app.authenticate, ...rl(20, "1 minute") }, async (req) => {
    const q = parse(reverseGeocodeQuerySchema, req.query);
    return opts.geocode.lookup(q.lat, q.lng);
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
    const [row, { st }] = await Promise.all([fetchOne(id), getMeta()]);
    if (!row || !canSee(st, auth, row)) throw new HttpError(404, "Ocorrência não encontrada"); // 404, não 403: não revela que existe
    const body: Record<string, unknown> = dto(row);
    if (isStaff(auth)) {
      // LGPD: o detalhe de staff traz contato de quem ligou e nome do autor. Registra antes de entregar.
      await auditAccess(req, { action: "occurrence.view", subjectType: "occurrence", subjectId: id, details: { source: row.source, withContact: !!row.contactEnc } }, db, auth!);
      Object.assign(body, staffExtras(row));
    }
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
    const [row, { st }] = await Promise.all([fetchOne(id), getMeta()]);
    if (!row || !row.photoKey || !canSee(st, auth, row)) throw new HttpError(404, "Foto não encontrada");
    const thumb = (req.query as { size?: string }).size === "thumb";
    let file;
    try {
      file = await openObject(thumb ? thumbKey(row.photoKey) : row.photoKey);
    } catch {
      throw new HttpError(404, "Foto não encontrada");
    }
    if (isStaff(auth) && !thumb) await auditAccess(req, { action: "occurrence.photo", subjectType: "occurrence", subjectId: id }, db, auth!);
    const open = isPublic(st, row.status);
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
    const where = and(
      q.status ? eq(occurrences.status, q.status) : undefined,
      q.category ? eq(occurrences.category, q.category) : undefined,
      q.bbox ? inBbox(q.bbox) : undefined,
      createdBetween(q.from, q.to),
    );
    const [{ items, nextCursor }, [totalRow]] = await Promise.all([
      page(where, q.limit, q.cursor, q.order),
      db.select({ n: count() }).from(occurrences).where(where),
    ]);
    await auditAccess(req, {
      action: "occurrence.list",
      subjectType: "occurrence",
      details: { count: items.length, withContact: items.filter((r) => r.contactEnc).length, ids: items.map((r) => r.id), filters: { status: q.status, category: q.category, from: q.from, to: q.to, bbox: !!q.bbox, hasCursor: !!q.cursor } },
    });
    return { items: items.map((r) => ({ ...dto(r), authorId: r.authorId, authorName: r.authorName, ...staffExtras(r) })), nextCursor, total: totalRow?.n ?? 0 };
  });

  // Cadastro manual (ex.: ligação por telefone). Foto opcional; entra já visível ao cidadão conforme o status escolhido.
  app.post("/staff/occurrences", { preHandler: staffOnly, ...rl(60, "1 minute") }, async (req, reply) => {
    const { fields, file } = await readMultipart(req);
    const data = parse(staffCreateFieldsSchema, fields);
    await assertInArea(data.lat, data.lng);
    const actor = req.auth;
    const { cat, st } = await getMeta();
    if (!cat.get(data.category)?.active) throw new HttpError(400, "Dados inválidos", { category: ["Categoria inválida"] });
    // Cadastro manual entra "não verificado" ou em andamento; resolvido/recusado só por transição (com histórico e motivo).
    const chosen = st.get(data.status);
    if (!chosen?.active || (chosen.kind !== "initial" && chosen.kind !== "active")) throw new HttpError(400, "Dados inválidos", { status: ["Status inválido para cadastro"] });
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
            neighborhood: data.neighborhood ?? null,
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
            ...(data.neighborhood ? { neighborhood: { to: data.neighborhood } } : {}),
            location: { to: { lat: data.lat, lng: data.lng } },
            photo: { to: photoKey },
            ...(contact ? { reporterContact: { to: "informado" } } : {}),
          },
          ip: req.ip,
        });
        return occurrenceId;
      });
      if (!data.neighborhood) opts.geocode.enqueue(id);
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
    if (body.lat !== undefined && body.lng !== undefined) await assertInArea(body.lat, body.lng);
    const actor = req.auth;
    const { cat, st } = await getMeta();
    if (body.category && !cat.get(body.category)?.active) throw new HttpError(400, "Dados inválidos", { category: ["Categoria inválida"] });

    const result = await db.transaction(async (tx) => {
      const cur = await fetchOne(id, tx, true); // trava a linha: duas edições simultâneas não se atropelam
      if (!cur) throw new HttpError(404, "Ocorrência não encontrada");

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (body.category && body.category !== cur.category) changes.category = { from: cur.category, to: body.category };
      if (body.description && body.description !== cur.description) changes.description = { from: cur.description, to: body.description };
      if (body.neighborhood && body.neighborhood !== cur.neighborhood) changes.neighborhood = { from: cur.neighborhood, to: body.neighborhood };
      if (body.lat !== undefined && body.lng !== undefined && (Math.abs(body.lat - cur.lat) > 1e-7 || Math.abs(body.lng - cur.lng) > 1e-7)) {
        changes.location = { from: { lat: cur.lat, lng: cur.lng }, to: { lat: body.lat, lng: body.lng } };
      }
      const newStatus = body.status && body.status !== cur.status ? body.status : null;
      const from = st.get(cur.status);
      const to = newStatus ? st.get(newStatus) : undefined;
      if (newStatus) {
        if (!to) throw new HttpError(400, "Dados inválidos", { status: ["Status inválido"] });
        if (!from || !canTransition(from, to)) {
          throw new HttpError(409, `Transição inválida: ${from?.name ?? cur.status} → ${to.name}`);
        }
        if (to.kind === "rejected" && !body.note) throw new HttpError(400, "Informe o motivo da recusa em 'note'");
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
          ...(changes.neighborhood ? { neighborhood: body.neighborhood } : {}),
          ...(changes.location ? { location: sql`ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)` as unknown as { x: number; y: number } } : {}),
          ...(newStatus ? { status: newStatus, resolvedAt: to?.kind === "resolved" ? sql`now()` : from?.kind === "resolved" ? null : undefined } : {}),
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
            `${cat.get(cur.category)?.name ?? cur.category} "${snippet}": ${from?.name ?? cur.status} → ${to!.name}.` +
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
    // Mudou o ponto e ainda não há bairro: tenta descobrir pelo novo local.
    if (result.changed && body.lat !== undefined && !result.neighborhood) opts.geocode.enqueue(id);
    return result;
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

  // Exportação (CSV) montada no painel: o painel avisa antes de baixar e a API registra quem exportou quantas linhas.
  // Cada página lida já fica registrada em occurrence.list (com os ids), então o conjunto exato é recuperável.
  app.post("/staff/audit/export", { preHandler: staffOnly, ...rl(10, "1 minute") }, async (req, reply) => {
    const body = parse(exportAuditSchema, req.body);
    await auditAccess(req, { action: "occurrence.export", subjectType: "occurrence", details: { format: "csv", count: body.count, filters: body.filters } });
    return reply.code(204).send();
  });

  // Números para o painel: contagem por status/categoria, tempo médio até resolver e criadas por dia.
  app.get("/staff/stats", { preHandler: staffOnly }, async () => {
    const [byStatus, byCategory, resolution, perDay, stale] = await Promise.all([
      db.select({ key: occurrences.status, total: count() }).from(occurrences).groupBy(occurrences.status),
      db.select({ key: occurrences.category, total: count() }).from(occurrences).groupBy(occurrences.category),
      db.execute(sql`select avg(extract(epoch from (resolved_at - created_at)) / 3600)::float8 as hours
        from occurrences where status in ${slugsOfKind("resolved")} and resolved_at is not null`),
      db.execute(sql`select to_char(d::date, 'YYYY-MM-DD') as day, coalesce(c.total, 0)::int as total
        from generate_series(current_date - 13, current_date, interval '1 day') d
        left join (select created_at::date as day, count(*) as total from occurrences
                   where created_at >= current_date - 13 group by 1) c on c.day = d::date
        order by d`),
      db.execute(sql`select count(*)::int as total from occurrences where status in ${slugsOfKind("initial")} and created_at < now() - interval '24 hours'`),
    ]);
    const hours = (resolution.rows[0] as { hours: number | null } | undefined)?.hours ?? null;
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.key, r.total])),
      byCategory: Object.fromEntries(byCategory.map((r) => [r.key, r.total])),
      avgResolutionHours: hours === null ? null : Math.round(hours * 10) / 10,
      perDay: perDay.rows as { day: string; total: number }[],
      unverifiedOver24h: (stale.rows[0] as { total: number } | undefined)?.total ?? 0,
    };
  });

  // Atividade recente em todas as ocorrências (quem fez o quê), para a visão geral.
  app.get("/staff/activity", { preHandler: staffOnly }, async (req) => {
    const { limit } = parse(activityQuerySchema, req.query);
    const rows = await db
      .select({
        id: occurrenceAudit.id,
        action: occurrenceAudit.action,
        occurrenceId: occurrenceAudit.occurrenceId,
        actorName: users.name,
        actorRole: occurrenceAudit.actorRole,
        changes: occurrenceAudit.changes,
        at: occurrenceAudit.createdAt,
        category: occurrences.category,
        description: occurrences.description,
      })
      .from(occurrenceAudit)
      .innerJoin(users, eq(users.id, occurrenceAudit.actorId))
      .innerJoin(occurrences, eq(occurrences.id, occurrenceAudit.occurrenceId))
      .orderBy(desc(occurrenceAudit.id))
      .limit(limit);
    await auditAccess(req, { action: "activity.view", details: { count: rows.length } });
    // Descrição resumida e sem o contato: a visão geral não precisa de mais que isso.
    return { items: rows.map((r) => ({ ...r, description: r.description.slice(0, 120) })) };
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
    await auditAccess(req, { action: "occurrence.audit_view", subjectType: "occurrence", subjectId: id, details: { entries: rows.length } }); // traz nome e IP de funcionários
    return { items: rows };
  });
}
