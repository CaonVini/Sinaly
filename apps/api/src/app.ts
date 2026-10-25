import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { registerAuth } from "./auth.js";
import { pool } from "./db/client.js";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { HttpError } from "./http.js";
import { meRoutes } from "./routes/me.js";
import { notificationRoutes } from "./routes/notifications.js";
import { occurrenceRoutes } from "./routes/occurrences.js";
import { configRoutes } from "./routes/config.js";
import { reportRoutes } from "./routes/reports.js";
import { adminRoutes } from "./routes/admin.js";
import { createGeocodeQueue, nominatim, type ReverseGeocoder } from "./geocode.js";

/** `geocoder`: injetável nos testes. Por padrão usa o Nominatim se GEOCODER_ENABLED=true. */
export async function buildApp({ rateLimit: limit = true, geocoder }: { rateLimit?: boolean; geocoder?: ReverseGeocoder | null } = {}) {
  const app = Fastify({
    logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1_048_576, // 1 MB; fotos vão direto ao storage, não pela API
  });

  // Aceita corpo vazio com Content-Type JSON (ex.: logout sem corpo); JSON inválido continua dando 400.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const err = Object.assign(new Error("JSON inválido"), { statusCode: 400 });
      done(err, undefined);
    }
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(",").map((o) => o.trim()),
  });
  if (limit) await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await registerAuth(app);

  // Qualquer resposta a requisição autenticada (dados pessoais, listas, trilhas) nunca é guardada por cache/proxy.
  // Rotas que definem a própria política (foto pública, mapa) mantêm a sua só quando NÃO há credencial.
  app.addHook("onSend", async (req, reply, payload) => {
    if (req.headers.authorization) {
      reply.header("Cache-Control", "private, no-store");
      reply.header("Vary", "Authorization");
    }
    return payload;
  });
  await authRoutes(app, { rateLimit: limit });
  await meRoutes(app);
  const geocode = createGeocodeQueue(geocoder !== undefined ? geocoder : env.GEOCODER_ENABLED ? nominatim : null, app.log);
  app.decorate("geocode", geocode);
  app.addHook("onClose", async () => geocode.idle());
  await occurrenceRoutes(app, { rateLimit: limit, geocode });
  await configRoutes(app, { rateLimit: limit, geocode });
  await reportRoutes(app);
  await adminRoutes(app, { rateLimit: limit });
  await notificationRoutes(app);

  // Nunca devolve detalhe interno: erros do banco (DrizzleQueryError) carregam o SQL e os parâmetros.
  app.setErrorHandler((err: Error & { statusCode?: number; details?: unknown }, req, reply) => {
    const status = err instanceof HttpError ? err.statusCode : err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, "erro não tratado");
      return reply.code(500).send({ error: "Erro interno" });
    }
    return reply.code(status).send({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  });

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  return app;
}
