/**
 * Muda o cargo de um funcionário direto no banco (uso: promover o primeiro administrador).
 *   pnpm staff:set-role --email maria@prefeitura.gov.br --role admin
 * Roda SOMENTE no servidor. Derruba as sessões abertas da conta e registra o evento.
 */
import { and, eq, isNull } from "drizzle-orm";
import { STAFF_ROLES } from "@sinaly/shared";
import { z } from "zod";
import { audit } from "../auth.js";
import { db, pool } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const input = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(STAFF_ROLES) }).parse({ email: arg("email"), role: arg("role") });

const [u] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, input.email));
if (!u || u.role === "cidadao") {
  console.error("Funcionário não encontrado.");
  process.exitCode = 1;
} else {
  await db.update(users).set({ role: input.role }).where(eq(users.id, u.id));
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt)));
  await audit(`role_changed_cli:${u.role}->${input.role}`, { userId: u.id, email: input.email });
  console.log(`${input.email}: ${u.role} -> ${input.role}. Sessões abertas foram encerradas; faça login de novo.`);
}
await pool.end();
