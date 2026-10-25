import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Nominatim falso: confere o contrato HTTP real (caminho, parâmetros, User-Agent) sem depender da internet.
let mode: "ok" | "forbidden" | "empty" = "ok";
const seen: { url: string; ua: string | undefined }[] = [];
const fake = createServer((req, res) => {
  seen.push({ url: req.url ?? "", ua: req.headers["user-agent"] });
  if (mode === "forbidden") return void res.writeHead(403).end("blocked");
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(mode === "empty" ? { error: "Unable to geocode" } : { address: { road: "Rua X", suburb: "Bela Vista", city: "São Paulo" } }));
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
const port = (fake.address() as { port: number }).port;

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ??= "j".repeat(48);
process.env.CPF_HASH_PEPPER ??= "p".repeat(48);
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "sinaly-uploads-"));
process.env.GEOCODER_URL = `http://127.0.0.1:${port}`;
process.env.GEOCODER_USER_AGENT = "Sinaly-Teste/1.0 (teste@example.com)";
if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL apontando para um banco de TESTE");

const { buildApp } = await import("../src/app.js");
const { db, pool } = await import("../src/db/client.js");
const { users } = await import("../src/db/schema.js");
const { nominatim } = await import("../src/geocode.js");
const { encrypt } = await import("../src/security/crypto.js");
const { hashPassword } = await import("../src/security/password.js");
const { generateTotpSecret, totpAt, currentStep } = await import("../src/security/totp.js");

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp({ rateLimit: false, geocoder: nominatim });
  await app.ready();
});
beforeEach(async () => {
  await pool.query("truncate users, auth_events cascade");
  seen.length = 0;
  mode = "ok";
});
afterAll(async () => {
  await app.close();
  await pool.end();
  fake.close();
});

async function gestor() {
  const secret = generateTotpSecret();
  await db.insert(users).values({ email: "g@prefeitura.gov.br", name: "Gestor", role: "gestor", passwordHash: await hashPassword("senha-do-funcionario-forte"), totpSecretEnc: encrypt(secret) });
  const res = await app.inject({ method: "POST", url: "/auth/staff/login", payload: { email: "g@prefeitura.gov.br", password: "senha-do-funcionario-forte", totp: totpAt(secret, currentStep()) } });
  return res.json().accessToken as string;
}
async function createOcc(token: string) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ category: "iluminacao", description: "Poste com a lâmpada apagada há uma semana", lat: "-23.5614", lng: "-46.6559" })) fd.append(k, v);
  const r = new Response(fd);
  const res = await app.inject({ method: "POST", url: "/staff/occurrences", payload: Buffer.from(await r.arrayBuffer()), headers: { authorization: `Bearer ${token}`, "content-type": r.headers.get("content-type")! } });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}
const status = async (t: string) => (await app.inject({ method: "GET", url: "/staff/geocode/status", headers: { authorization: `Bearer ${t}` } })).json();

describe("geocodificação real (Nominatim falso)", () => {
  it("chama /reverse com coordenadas, idioma e User-Agent, e grava o bairro", async () => {
    const t = await gestor();
    const id = await createOcc(t);
    await app.geocode.idle();
    expect(seen).toHaveLength(1);
    const u = new URL(seen[0]!.url, "http://x");
    expect(u.pathname).toBe("/reverse");
    expect(u.searchParams.get("lat")).toBe("-23.5614");
    expect(u.searchParams.get("lon")).toBe("-46.6559");
    expect(u.searchParams.get("accept-language")).toBe("pt-BR");
    expect(seen[0]!.ua).toBe("Sinaly-Teste/1.0 (teste@example.com)");
    expect((await pool.query("select neighborhood from occurrences where id = $1", [id])).rows[0].neighborhood).toBe("Bela Vista");
    expect(await status(t)).toMatchObject({ enabled: true, filled: 1, failed: 0, missing: 0 });
  });

  it("serviço recusando (403) fica visível no status com o motivo", async () => {
    const t = await gestor();
    mode = "forbidden";
    await createOcc(t);
    await app.geocode.idle();
    const s = await status(t);
    expect(s).toMatchObject({ failed: 1, missing: 1 });
    expect(s.lastError).toContain("HTTP 403");
  });

  it("ponto sem bairro conhecido conta como 'não encontrado', não como erro", async () => {
    const t = await gestor();
    mode = "empty";
    await createOcc(t);
    await app.geocode.idle();
    expect(await status(t)).toMatchObject({ notFound: 1, failed: 1, missing: 1 }) // contadores acumulam desde o início do processo;
  });

  it("backfill preenche as que ficaram sem bairro", async () => {
    const t = await gestor();
    mode = "forbidden";
    await createOcc(t);
    await app.geocode.idle();
    mode = "ok";
    const res = await app.inject({ method: "POST", url: "/staff/geocode/backfill", headers: { authorization: `Bearer ${t}` } });
    expect(res.json()).toMatchObject({ queued: 1 });
    await app.geocode.idle();
    expect(await status(t)).toMatchObject({ missing: 0 });
  });
});
