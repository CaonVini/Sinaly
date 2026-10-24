import argon2 from "argon2";
import { randomBytes } from "node:crypto";

// OWASP: argon2id, m=19 MiB, t=2, p=1 (mínimo recomendado). Ajuste com medição no servidor.
const options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => argon2.hash(password, options);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Hash descartável: login de e-mail inexistente gasta o mesmo tempo de um existente,
// evitando enumeração de contas por tempo de resposta.
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString("hex")));
