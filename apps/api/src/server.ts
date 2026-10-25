import { buildApp } from "./app.js";
import { pool } from "./db/client.js";
import { env } from "./env.js";

const app = await buildApp();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: env.PORT, host: "0.0.0.0" });

// Ao subir, preenche o bairro das ocorrências que ainda não têm (melhor esforço, em segundo plano).
if (app.geocode.enabled) setTimeout(() => app.geocode.backfill(200).catch((err) => app.log.warn({ err }, "backfill de bairro falhou")), 5_000);
