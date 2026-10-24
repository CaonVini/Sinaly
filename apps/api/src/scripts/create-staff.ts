/**
 * Cria funcionário da prefeitura. Roda SOMENTE no servidor, com acesso ao banco:
 *   pnpm staff:create --email maria@prefeitura.gov.br --name "Maria Silva" --role servidor
 * Não existe rota HTTP equivalente. A senha e o segredo TOTP aparecem uma única vez.
 */
import { randomInt } from "node:crypto";
import { PASSWORD_MIN_STAFF, roleSchema } from "@sinaly/shared";
import { z } from "zod";
import { audit } from "../auth.js";
import { db, pool } from "../db/client.js";
import { users } from "../db/schema.js";
import { encrypt } from "../security/crypto.js";
import { hashPassword } from "../security/password.js";
import { generateTotpSecret, otpauthUri } from "../security/totp.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const input = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().min(2).max(120),
    role: roleSchema.refine((r) => r !== "cidadao", "Use servidor ou gestor"),
  })
  .parse({ email: arg("email"), name: arg("name"), role: arg("role") });

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?";
const password = Array.from({ length: Math.max(24, PASSWORD_MIN_STAFF) }, () => CHARS[randomInt(CHARS.length)]).join("");
const totpSecret = generateTotpSecret();

const [user] = await db
  .insert(users)
  .values({
    email: input.email,
    name: input.name,
    role: input.role,
    passwordHash: await hashPassword(password),
    totpSecretEnc: encrypt(totpSecret),
  })
  .returning({ id: users.id });
await audit("staff_created", { userId: user!.id, email: input.email });
await pool.end();

console.log(`\nFuncionário criado: ${input.email} (${input.role})`);
console.log(`Senha inicial (anote agora, não será exibida de novo): ${password}`);
console.log(`Segredo TOTP: ${totpSecret}`);
console.log(`Cadastre no app autenticador (Google Authenticator, Authy...):\n${otpauthUri(totpSecret, input.email)}\n`);
