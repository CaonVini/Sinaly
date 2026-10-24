import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { registerAuth } from "./auth.js";
import { pool } from "./db/client.js";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";

export async function buildApp({ rateLimit: limit = true }: { rateLimit?: boolean } = {}) {
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
  await authRoutes(app, { rateLimit: limit });
  await meRoutes(app);

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  return app;
}
