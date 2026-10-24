import { eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { loginSchema, refreshSchema, registerSchema, staffLoginSchema, type Role } from "@sinaly/shared";
import { audit, issueTokens, rotateRefresh } from "../auth.js";
import { db } from "../db/client.js";
import { isUniqueViolation } from "../db/errors.js";
import { sessions, users } from "../db/schema.js";
import { decrypt } from "../security/crypto.js";
import { dummyHash, hashPassword, verifyPassword } from "../security/password.js";
import { verifyTotp } from "../security/totp.js";

const FAIL = { error: "Credenciais inválidas" } as const;
const LIMITS = {
  citizen: { maxAttempts: 5, lockMinutes: 15 },
  staff: { maxAttempts: 5, lockMinutes: 60 },
};

type Kind = "citizen" | "staff";

export async function authRoutes(app: FastifyInstance, opts: { rateLimit: boolean }) {
  const rl = (max: number, timeWindow: string) =>
    opts.rateLimit ? { config: { rateLimit: { max, timeWindow } } } : {};
  const ctxOf = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });

  // Único registro público: sempre cria CIDADÃO. O papel nunca vem do cliente.
  app.post("/auth/register", rl(10, "1 hour"), async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    const { email, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    try {
      const [user] = await db.insert(users).values({ email, passwordHash, role: "cidadao" }).returning({ id: users.id, role: users.role });
      await audit("register", { userId: user!.id, email, ip: req.ip });
      const tokens = await issueTokens(app, user!, ctxOf(req));
      return reply.code(201).send({ onboardingComplete: false, ...tokens });
    } catch (e) {
      if (isUniqueViolation(e)) return reply.code(409).send({ error: "E-mail já cadastrado" });
      throw e;
    }
  });

  app.post("/auth/login", rl(10, "1 minute"), async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(401).send(FAIL);
    return login(req, reply, "citizen", parsed.data.email, parsed.data.password);
  });

  // Rota separada e mais rígida para funcionários: senha + código TOTP obrigatórios.
  app.post("/auth/staff/login", rl(10, "15 minutes"), async (req, reply) => {
    const parsed = staffLoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(401).send(FAIL);
    return login(req, reply, "staff", parsed.data.email, parsed.data.password, parsed.data.totp);
  });

  async function login(req: FastifyRequest, reply: FastifyReply, kind: Kind, email: string, password: string, totp?: string) {
    const allowed: Role[] = kind === "citizen" ? ["cidadao"] : ["servidor", "gestor"];
    const limits = LIMITS[kind];
    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    // Sempre verifica uma senha (real ou descartável): tempo de resposta não revela se a conta existe.
    const passOk = await verifyPassword(u?.passwordHash ?? (await dummyHash()), password);
    const eligible = !!u && allowed.includes(u.role) && u.isActive && !(u.lockedUntil && u.lockedUntil > new Date());

    let step: number | null = null;
    if (eligible && passOk && kind === "staff") {
      if (u.totpSecretEnc && totp) {
        step = verifyTotp(decrypt(u.totpSecretEnc), totp);
        if (step !== null && u.totpLastStep !== null && step <= u.totpLastStep) step = null; // replay
      }
    }
    const success = eligible && passOk && (kind === "citizen" || step !== null);

    if (!success) {
      if (eligible) {
        // Contagem e bloqueio atômicos em SQL (sem corrida entre tentativas simultâneas).
        await db.execute(sql`
          update users set
            failed_login_attempts = case when failed_login_attempts + 1 >= ${limits.maxAttempts} then 0 else failed_login_attempts + 1 end,
            locked_until = case when failed_login_attempts + 1 >= ${limits.maxAttempts}
              then now() + make_interval(mins => ${limits.lockMinutes}) else locked_until end
          where id = ${u.id}`);
      }
      await audit(`${kind}_login_failed`, { userId: u?.id, email, ip: req.ip });
      return reply.code(401).send(FAIL);
    }

    await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), ...(step !== null ? { totpLastStep: step } : {}) }).where(eq(users.id, u.id));
    await audit(`${kind}_login`, { userId: u.id, email, ip: req.ip });
    const tokens = await issueTokens(app, u, ctxOf(req));
    return { role: u.role, ...tokens };
  }

  app.post("/auth/refresh", rl(30, "1 minute"), async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(401).send({ error: "Sessão inválida" });
    const tokens = await rotateRefresh(app, parsed.data.refreshToken, ctxOf(req));
    if (!tokens) return reply.code(401).send({ error: "Sessão inválida" });
    return tokens;
  });

  app.post("/auth/logout", { ...rl(30, "1 minute"), preHandler: app.authenticate }, async (req, reply) => {
    await db.update(sessions).set({ revokedAt: new Date() }).where(sql`${sessions.familyId} = ${req.auth.familyId} and ${sessions.revokedAt} is null`);
    await audit("logout", { userId: req.auth.userId, ip: req.ip });
    return reply.code(204).send();
  });
}

