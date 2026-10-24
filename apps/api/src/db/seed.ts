// Seed só para staging/desenvolvimento. Nunca rode em produção.
import { env } from "../env.js";
import { pool } from "./client.js";

if (env.NODE_ENV === "production") throw new Error("Seed bloqueado em produção.");

await pool.query(
  `INSERT INTO users (name, email, password_hash, role)
   VALUES ('Servidor Demo', 'servidor@sinaly.local', 'SUBSTITUIR_POR_HASH_ARGON2', 'servidor')
   ON CONFLICT (email) DO NOTHING`,
);
await pool.end();
console.log("Seed concluído (usuário servidor sem senha utilizável até o auth existir).");
