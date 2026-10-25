import { randomInt } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { PASSWORD_MIN_STAFF, accessAuditQuerySchema, staffCreateSchema, staffPatchSchema, staffResetSchema, type Role } from "@sinaly/shared";
import { auditAccess } from "../access-audit.js";
import { audit } from "../auth.js";
import { db } from "../db/client.js";
import { isUniqueViolation } from "../db/errors.js";
import { accessAudit, sessions, users } from "../db/schema.js";
import { HttpError, limitConfig, parse, UUID_RE } from "../http.js";
import { decrypt, encrypt } from "../security/crypto.js";
import { hashPassword } from "../security/password.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../security/totp.js";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?";
const newPassword = () => Array.from({ length: Math.max(24, PASSWORD_MIN_STAFF) }, () => CHARS[randomInt(CHARS.length)]).join("");
const noStore = (reply: { header: (k: string, v: string) => unknown }) => reply.header("Cache-Control", "no-store");

const publicUser = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  locked: sql<boolean>`${users.lockedUntil} is not null and ${users.lockedUntil} > now()`,
};
const STAFF: Role[] = ["servidor", "gestor", "admin"];

export async function adminRoutes(app: FastifyInstance, opts: { rateLimit: boolean }) {
  const adminOnly = app.requireRole("admin");
  const rl = (max: number, window: string) => limitConfig(opts.rateLimit, max, window);

  /**
   * Confirmação de identidade a cada ação sensível: o admin informa o código TOTP atual dele.
   * Código reaproveitado (mesmo passo ou anterior) é recusado; falhas são registradas e o limite por IP é baixo.
   */
  async function stepUp(req: FastifyRequest, code: string) {
    const [me] = await db.select({ enc: users.totpSecretEnc, last: users.totpLastStep }).from(users).where(eq(users.id, req.auth.userId));
    const step = me?.enc ? verifyTotp(decrypt(me.enc), code) : null;
    const fresh = step !== null && (me!.last === null || step > me!.last);
    // Reserva o passo de forma atômica: duas requisições com o mesmo código não passam juntas.
    const claimed = fresh
      ? await db.update(users).set({ totpLastStep: step }).where(and(eq(users.id, req.auth.userId), sql`(${users.totpLastStep} is null or ${users.totpLastStep} < ${step})`)).returning({ id: users.id })
      : [];
    if (claimed.length === 0) {
      await audit("stepup_failed", { userId: req.auth.userId, ip: req.ip });
      throw new HttpError(403, "Código de confirmação inválido ou já usado. Aguarde o próximo código do aplicativo.");
    }
  }

  const idParam = (req: FastifyRequest) => {
    const id = (req.params as { id?: string }).id;
    if (!id || !UUID_RE.test(id)) throw new HttpError(404, "Conta não encontrada");
    return id;
  };

  const revokeSessions = (userId: string, tx: Pick<typeof db, "update"> = db) =>
    tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));

  // ---------- contas de funcionário ----------
  app.get("/admin/staff", { preHandler: adminOnly }, async (req, reply) => {
    const rows = await db.select(publicUser).from(users).where(inArray(users.role, STAFF)).orderBy(users.createdAt);
    await auditAccess(req, { action: "staff.list", subjectType: "user", details: { count: rows.length } });
    noStore(reply);
    return { items: rows };
  });

  app.post("/admin/staff", { preHandler: adminOnly, ...rl(10, "15 minutes") }, async (req, reply) => {
    const body = parse(staffCreateSchema, req.body);
    await stepUp(req, body.totp);
    const password = newPassword();
    const totpSecret = generateTotpSecret();
    try {
      const user = await db.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({ email: body.email, name: body.name, role: body.role, passwordHash: await hashPassword(password), totpSecretEnc: encrypt(totpSecret) })
          .returning(publicUser);
        await auditAccess(req, { action: "staff.create", subjectType: "user", subjectId: u!.id, details: { email: body.email, role: body.role } }, tx);
        return u!;
      });
      await audit("staff_created", { userId: user.id, email: body.email, ip: req.ip });
      noStore(reply);
      // Credenciais aparecem UMA vez, só nesta resposta (nunca em log nem em auditoria).
      return reply.code(201).send({ user, credentials: { password, totpSecret, otpauthUri: otpauthUri(totpSecret, body.email) } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, "Já existe uma conta com esse e-mail");
      throw e;
    }
  });

  app.patch("/admin/staff/:id", { preHandler: adminOnly, ...rl(20, "15 minutes") }, async (req, reply) => {
    const id = idParam(req);
    const body = parse(staffPatchSchema, req.body);
    if (id === req.auth.userId) throw new HttpError(409, "Você não pode alterar a sua própria conta. Peça a outro administrador.");
    await stepUp(req, body.totp);
    const updated = await db.transaction(async (tx) => {
      const [cur] = await tx.select(publicUser).from(users).where(and(eq(users.id, id), inArray(users.role, STAFF))).for("update");
      if (!cur) throw new HttpError(404, "Conta não encontrada"); // cidadão nunca é gerido por aqui
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (body.role && body.role !== cur.role) changes.role = { from: cur.role, to: body.role };
      if (body.active !== undefined && body.active !== cur.isActive) changes.active = { from: cur.isActive, to: body.active };
      if (Object.keys(changes).length === 0) return cur;
      await tx.update(users).set({ ...(changes.role ? { role: body.role } : {}), ...(changes.active ? { isActive: body.active } : {}) }).where(eq(users.id, id));
      // Mudou cargo ou desativou: derruba as sessões abertas, o novo cargo vale no próximo login.
      await revokeSessions(id, tx);
      await auditAccess(req, { action: "staff.update", subjectType: "user", subjectId: id, details: { email: cur.email, changes } }, tx);
      const [after] = await tx.select(publicUser).from(users).where(eq(users.id, id));
      return after!;
    });
    noStore(reply);
    return updated;
  });

  app.post("/admin/staff/:id/reset", { preHandler: adminOnly, ...rl(10, "15 minutes") }, async (req, reply) => {
    const id = idParam(req);
    const body = parse(staffResetSchema, req.body);
    if (id === req.auth.userId) throw new HttpError(409, "Você não pode redefinir o seu próprio acesso. Peça a outro administrador.");
    await stepUp(req, body.totp);
    const password = newPassword();
    const totpSecret = generateTotpSecret();
    const email = await db.transaction(async (tx) => {
      const [cur] = await tx.select({ email: users.email }).from(users).where(and(eq(users.id, id), inArray(users.role, STAFF))).for("update");
      if (!cur) throw new HttpError(404, "Conta não encontrada");
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(password), totpSecretEnc: encrypt(totpSecret), totpLastStep: null, failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(users.id, id));
      await revokeSessions(id, tx);
      await auditAccess(req, { action: "staff.reset", subjectType: "user", subjectId: id, details: { email: cur.email } }, tx);
      return cur.email;
    });
    noStore(reply);
    return { credentials: { password, totpSecret, otpauthUri: otpauthUri(totpSecret, email) } };
  });

  // ---------- trilha de acessos (LGPD) ----------
  app.get("/admin/access-audit", { preHandler: adminOnly }, async (req, reply) => {
    const q = parse(accessAuditQuerySchema, req.query);
    const before = q.cursor ? decodeIdCursor(q.cursor) : null;
    const rows = await db
      .select({
        id: accessAudit.id,
        action: accessAudit.action,
        actorId: accessAudit.actorId,
        actorName: users.name,
        actorEmail: users.email,
        actorRole: accessAudit.actorRole,
        subjectType: accessAudit.subjectType,
        subjectId: accessAudit.subjectId,
        details: accessAudit.details,
        ip: accessAudit.ip,
        at: accessAudit.createdAt,
      })
      .from(accessAudit)
      .innerJoin(users, eq(users.id, accessAudit.actorId))
      .where(and(q.action ? eq(accessAudit.action, q.action) : undefined, q.actor ? eq(accessAudit.actorId, q.actor) : undefined, before !== null ? sql`${accessAudit.id} < ${before}` : undefined))
      .orderBy(desc(accessAudit.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit);
    // Quem lê a trilha também fica registrado (sem listar os ids de cada linha).
    await auditAccess(req, { action: "access_audit.view", details: { count: items.length, action: q.action, actor: q.actor } });
    noStore(reply);
    return { items, nextCursor: rows.length > q.limit ? encodeIdCursor(items.at(-1)!.id) : null };
  });
}

const encodeIdCursor = (id: number) => Buffer.from(JSON.stringify({ i: id })).toString("base64url");
function decodeIdCursor(cursor: string): number {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (Number.isInteger(v.i) && v.i > 0) return v.i;
  } catch {
    /* erro abaixo */
  }
  throw new HttpError(400, "Cursor inválido");
}
