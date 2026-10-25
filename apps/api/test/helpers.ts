import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "vitest";

/** Variáveis de ambiente de teste; importar ANTES de carregar o app. */
export function testEnv() {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET ??= "j".repeat(48);
  process.env.CPF_HASH_PEPPER ??= "p".repeat(48);
  process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "sinaly-uploads-"));
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL apontando para um banco de TESTE");
}

export const STAFF_PASS = "senha-do-funcionario-forte";
export const PASS = "senha-bem-longa-123";
export const profile = (cpf: string) => ({
  firstName: "Maria", lastName: "da Silva", phone: "11912345678", cpf,
  address: { cep: "01001000", street: "Praça da Sé", number: "10", neighborhood: "Sé", city: "São Paulo", state: "SP" },
});

export async function multipart(app: { inject: (o: object) => Promise<{ statusCode: number; json: () => unknown; body: string }> }, method: "POST" | "PUT", url: string, token: string | undefined, fields: Record<string, string>, file?: { data: Buffer; name?: string; type?: string; field?: string }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append(file.field ?? "photo", new Blob([new Uint8Array(file.data)], { type: file.type ?? "image/jpeg" }), file.name ?? "foto.jpg");
  const res = new Response(fd);
  return app.inject({ method, url, payload: Buffer.from(await res.arrayBuffer()), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": res.headers.get("content-type")! } });
}
export { expect };
