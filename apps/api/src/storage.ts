import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";

// Armazenamento em disco atrás de uma interface mínima (put/open/remove): trocar por S3/R2
// depois significa reescrever só este arquivo. A chave é sempre gerada pelo servidor.
const root = path.resolve(env.UPLOAD_DIR);
const KEY = /^occ\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-t)?\.jpg$/;

function resolveKey(key: string): string {
  if (!KEY.test(key)) throw new Error("Chave de arquivo inválida");
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Caminho fora da pasta de uploads");
  return full;
}

export const thumbKey = (key: string) => key.replace(/\.jpg$/, "-t.jpg");

export async function putObject(key: string, data: Buffer): Promise<void> {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data, { flag: "wx", mode: 0o640 }); // wx: nunca sobrescreve
}

export async function openObject(key: string) {
  const full = resolveKey(key);
  const info = await stat(full);
  return { stream: createReadStream(full), size: info.size };
}

export async function removeObject(key: string): Promise<void> {
  await rm(resolveKey(key), { force: true });
}
