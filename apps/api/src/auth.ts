import jwt from "@fastify/jwt";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@sinaly/shared";
import { db } from "./db/client.js";
import { authEvents, sessions, users } from "./db/schema.js";
import { env } from "./env.js";
import { randomToken, sha256 } from "./security/crypto.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; fid: string };
    user: { sub: string; fid: string };
  }
}
export interface Auth {
  userId: string;
  role: Role;
  familyId: string;
}
declare module "fastify" {
  interface FastifyRequest {
    auth: Auth;
  }
  interface FastifyInstance {
    geocode: import("./geocode.js").GeocodeQueue;
    tryAuth: (req: FastifyRequest) => Promise<Auth | null>;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const ACCESS_TTL = "15m";
const REFRESH_TTL_MS: Record<Role, number> = {
  cidadao: 30 * 24 * 3600_000,
  servidor: 8 * 3600_000, // funcionário: sessão de um turno
  gestor: 8 * 3600_000,
  admin: 4 * 3600_000, // conta mais poderosa: sessão mais curta
};

export async function registerAuth(app: FastifyInstance) {
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { algorithm: "HS256", iss: "sinaly-api", expiresIn: ACCESS_TTL },
    verify: { algorithms: ["HS256"], allowedIss: "sinaly-api" },
  });

  app.decorateRequest("auth", undefined as never);

  // Valida assinatura/expiração E consulta o banco: conta desativada ou sessão
  // revogada (logout, reuso de refresh) perde acesso imediatamente, sem esperar o token vencer.
  async function resolveAuth(req: FastifyRequest): Promise<Auth | null> {
    try {
      await req.jwtVerify();
    } catch {
      return null;
    }
    // Defesa em profundidade: a biblioteca só confere o emissor se ele vier no token; aqui exigimos emissor e validade.
    const claims = req.user as { sub: string; fid: string; iss?: string; exp?: number };
    if (claims.iss !== "sinaly-api" || typeof claims.exp !== "number" || typeof claims.fid !== "string") return null;
    const { sub, fid } = claims;
    const [row] = await db
      .select({ role: users.role })
      .from(users)
      .where(
        and(
          eq(users.id, sub),
          eq(users.isActive, true),
          sql`exists (select 1 from ${sessions} where ${sessions.familyId} = ${fid} and ${sessions.userId} = ${users.id} and ${sessions.revokedAt} is null and ${sessions.expiresAt} > now())`,
        ),
      )
      .limit(1);
    return row ? { userId: sub, role: row.role, familyId: fid } : null;
  }

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await resolveAuth(req);
    if (!auth) return reply.code(401).send({ error: "Não autenticado" });
    req.auth = auth;
  });

  // Rotas públicas que mostram mais para quem está logado: nunca responde 401, devolve null.
  app.decorate("tryAuth", async (req: FastifyRequest) => (req.headers.authorization ? resolveAuth(req) : null));

  app.decorate("requireRole", (...roles: Role[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    if (!roles.includes(req.auth.role)) return reply.code(403).send({ error: "Sem permissão" });
  });
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export async function issueTokens(
  app: FastifyInstance,
  user: { id: string; role: Role },
  ctx: { ip: string; userAgent?: string },
  familyId: string = crypto.randomUUID(),
): Promise<Tokens> {
  const refreshToken = randomToken();
  await db.insert(sessions).values({
    userId: user.id,
    familyId,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS[user.role]),
    ip: ctx.ip,
    userAgent: ctx.userAgent?.slice(0, 255),
  });
  const accessToken = app.jwt.sign({ sub: user.id, fid: familyId });
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL };
}

export async function rotateRefresh(
  app: FastifyInstance,
  refreshToken: string,
  ctx: { ip: string; userAgent?: string },
): Promise<Tokens | null> {
  const [s] = await db.select().from(sessions).where(eq(sessions.tokenHash, sha256(refreshToken))).limit(1);
  if (!s) return null;
  if (s.revokedAt) {
    // Token já usado sendo reapresentado = provável roubo. Derruba a cadeia inteira.
    await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.familyId, s.familyId), isNull(sessions.revokedAt)));
    await audit("refresh_reuse_detected", { userId: s.userId, ip: ctx.ip });
    return null;
  }
  if (s.expiresAt <= new Date()) return null;
  const [u] = await db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, s.userId)).limit(1);
  if (!u || !u.isActive) return null;
  // Revoga atomicamente: se duas requisições disputam o mesmo token, só uma vence.
  const claimed = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, s.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .returning({ id: sessions.id });
  if (claimed.length === 0) return null;
  return issueTokens(app, u, ctx, s.familyId);
}

export async function audit(event: string, data: { userId?: string; email?: string; ip?: string }) {
  await db.insert(authEvents).values({ event, userId: data.userId, email: data.email, ip: data.ip });
}
