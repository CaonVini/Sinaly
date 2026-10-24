import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isValidCpf } from "@sinaly/shared";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ??= "j".repeat(48);
process.env.CPF_HASH_PEPPER ??= "p".repeat(48);
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL apontando para um banco de TESTE");

const { buildApp } = await import("../src/app.js");
const { db, pool } = await import("../src/db/client.js");
const { users } = await import("../src/db/schema.js");
const { encrypt, decrypt } = await import("../src/security/crypto.js");
const { hashPassword } = await import("../src/security/password.js");
const { generateTotpSecret, totpAt, currentStep } = await import("../src/security/totp.js");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

const PASS = "senha-bem-longa-123";
const profile = (cpf = "529.982.247-25") => ({
  firstName: "Maria",
  lastName: "da Silva",
  phone: "(11) 91234-5678",
  cpf,
  address: { cep: "01001-000", street: "Praça da Sé", number: "10", neighborhood: "Sé", city: "São Paulo", state: "SP" },
});

const post = (url: string, payload: unknown, token?: string) =>
  app.inject({ method: "POST", url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
const get = (url: string, token?: string) =>
  app.inject({ method: "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function registerCitizen(email = "ana@example.com") {
  const res = await post("/auth/register", { email, password: PASS });
  return { res, ...res.json() } as { res: typeof res; accessToken: string; refreshToken: string };
}

async function createStaff(role: "servidor" | "gestor" = "servidor", email = "func@prefeitura.gov.br") {
  const secret = generateTotpSecret();
  const [u] = await db.insert(users).values({
    email, name: "Func", role, passwordHash: await hashPassword("senha-do-funcionario-forte"), totpSecretEnc: encrypt(secret),
  }).returning();
  return { user: u!, secret };
}

beforeAll(async () => {
  app = await buildApp({ rateLimit: false });
  app.get("/_staff-only", { preHandler: app.requireRole("servidor", "gestor") }, async () => ({ ok: true }));
  await app.ready();
});
beforeEach(async () => {
  await pool.query("truncate users, auth_events cascade");
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("primitivas", () => {
  it("TOTP bate com o vetor da RFC 6238", () => {
    expect(totpAt("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1)).toBe("287082");
  });
  it("valida CPF", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-24")).toBe(false);
  });
  it("cifra e decifra; adulteração é detectada", () => {
    const enc = encrypt("52998224725");
    expect(enc).not.toContain("52998224725");
    expect(decrypt(enc)).toBe("52998224725");
    const [v, iv, tag, ct] = enc.split(".");
    expect(() => decrypt([v, iv, tag, ct!.slice(0, -2) + "AA"].join("."))).toThrow();
  });
});

describe("registro e onboarding do cidadão", () => {
  it("cria sempre cidadão, ignorando papel enviado pelo cliente", async () => {
    const res = await post("/auth/register", { email: "x@example.com", password: PASS, role: "gestor" });
    expect(res.statusCode).toBe(201);
    const me = await get("/me", res.json().accessToken);
    expect(me.json()).toMatchObject({ role: "cidadao", onboardingComplete: false });
  });
  it("rejeita e-mail duplicado e senha curta", async () => {
    await registerCitizen();
    expect((await post("/auth/register", { email: "ana@example.com", password: PASS })).statusCode).toBe(409);
    expect((await post("/auth/register", { email: "b@example.com", password: "curta" })).statusCode).toBe(400);
  });
  it("onboarding valida CPF, grava cifrado e só ocorre uma vez", async () => {
    const { accessToken } = await registerCitizen();
    expect((await post("/me/onboarding", profile("111.111.111-11"), accessToken)).statusCode).toBe(400);
    expect((await post("/me/onboarding", { ...profile(), phone: "123" }, accessToken)).statusCode).toBe(400);
    expect((await post("/me/onboarding", profile(), accessToken)).statusCode).toBe(201);
    expect((await get("/me", accessToken)).json().onboardingComplete).toBe(true);
    expect((await post("/me/onboarding", profile("390.533.447-05"), accessToken)).statusCode).toBe(409);
    const { rows } = await pool.query("select cpf_hash, cpf_enc, phone from citizen_profiles");
    expect(JSON.stringify(rows)).not.toContain("52998224725");
    expect(rows[0].cpf_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].phone).toBe("11912345678");
  });
  it("não permite o mesmo CPF em duas contas", async () => {
    const a = await registerCitizen("a@example.com");
    const b = await registerCitizen("b@example.com");
    expect((await post("/me/onboarding", profile(), a.accessToken)).statusCode).toBe(201);
    const dup = await post("/me/onboarding", profile(), b.accessToken);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe("CPF já cadastrado");
  });
});

describe("login do cidadão", () => {
  it("entra com a senha certa; erro é idêntico para senha errada e e-mail inexistente", async () => {
    await registerCitizen();
    expect((await post("/auth/login", { email: "ana@example.com", password: PASS })).statusCode).toBe(200);
    const wrong = await post("/auth/login", { email: "ana@example.com", password: "errada-errada-1" });
    const ghost = await post("/auth/login", { email: "nao@existe.com", password: "errada-errada-1" });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toBe(ghost.body);
  });
  it("bloqueia a conta após 5 erros, mesmo com a senha certa", async () => {
    await registerCitizen();
    for (let i = 0; i < 5; i++) await post("/auth/login", { email: "ana@example.com", password: "errada-errada-1" });
    expect((await post("/auth/login", { email: "ana@example.com", password: PASS })).statusCode).toBe(401);
  });
  it("cidadão não entra pela rota de funcionário", async () => {
    await registerCitizen();
    const res = await post("/auth/staff/login", { email: "ana@example.com", password: PASS, totp: "123456" });
    expect(res.statusCode).toBe(401);
  });
});

describe("funcionário", () => {
  it("não existe rota pública para cadastrar funcionário", async () => {
    for (const url of ["/auth/staff/register", "/staff", "/auth/staff"]) {
      expect((await post(url, { email: "a@b.com", password: PASS, role: "gestor" })).statusCode).toBe(404);
    }
  });
  it("exige senha + TOTP; rejeita código errado e reaproveitado (replay)", async () => {
    const { secret } = await createStaff();
    const email = "func@prefeitura.gov.br", password = "senha-do-funcionario-forte";
    expect((await post("/auth/staff/login", { email, password, totp: "000000" })).statusCode).toBe(401);
    const code = totpAt(secret, currentStep());
    const ok = await post("/auth/staff/login", { email, password, totp: code });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().role).toBe("servidor");
    expect((await post("/auth/staff/login", { email, password, totp: code })).statusCode).toBe(401);
  });
  it("funcionário não entra pela rota do cidadão", async () => {
    await createStaff();
    const res = await post("/auth/login", { email: "func@prefeitura.gov.br", password: "senha-do-funcionario-forte" });
    expect(res.statusCode).toBe(401);
  });
  it("bloqueia após 5 erros de TOTP", async () => {
    const { secret } = await createStaff();
    const email = "func@prefeitura.gov.br", password = "senha-do-funcionario-forte";
    for (let i = 0; i < 5; i++) await post("/auth/staff/login", { email, password, totp: "000000" });
    const res = await post("/auth/staff/login", { email, password, totp: totpAt(secret, currentStep()) });
    expect(res.statusCode).toBe(401);
  });
  it("rota de funcionário recusa cidadão (403) e anônimo (401)", async () => {
    const { secret } = await createStaff();
    const citizen = await registerCitizen();
    expect((await get("/_staff-only")).statusCode).toBe(401);
    expect((await get("/_staff-only", citizen.accessToken)).statusCode).toBe(403);
    const login = await post("/auth/staff/login", { email: "func@prefeitura.gov.br", password: "senha-do-funcionario-forte", totp: totpAt(secret, currentStep()) });
    expect((await get("/_staff-only", login.json().accessToken)).statusCode).toBe(200);
  });
  it("desativar o funcionário derruba o acesso na hora", async () => {
    const { secret, user } = await createStaff();
    const login = await post("/auth/staff/login", { email: user.email, password: "senha-do-funcionario-forte", totp: totpAt(secret, currentStep()) });
    const { accessToken } = login.json();
    expect((await get("/_staff-only", accessToken)).statusCode).toBe(200);
    await pool.query("update users set is_active = false where id = $1", [user.id]);
    expect((await get("/_staff-only", accessToken)).statusCode).toBe(401);
  });
});

describe("sessões", () => {
  it("refresh rotaciona; reuso do token antigo derruba a cadeia inteira", async () => {
    const first = await registerCitizen();
    const second = await post("/auth/refresh", { refreshToken: first.refreshToken });
    expect(second.statusCode).toBe(200);
    const { accessToken, refreshToken } = second.json();
    expect((await get("/me", accessToken)).statusCode).toBe(200);
    expect((await post("/auth/refresh", { refreshToken: first.refreshToken })).statusCode).toBe(401); // reuso
    expect((await post("/auth/refresh", { refreshToken })).statusCode).toBe(401); // cadeia revogada
    expect((await get("/me", accessToken)).statusCode).toBe(401);
  });
  it("logout invalida o access token imediatamente", async () => {
    const { accessToken, refreshToken } = await registerCitizen();
    expect((await post("/auth/logout", {}, accessToken)).statusCode).toBe(204);
    expect((await get("/me", accessToken)).statusCode).toBe(401);
    expect((await post("/auth/refresh", { refreshToken })).statusCode).toBe(401);
  });
  it("rejeita token adulterado ou assinado com outro segredo", async () => {
    const { accessToken } = await registerCitizen();
    const forged = accessToken.slice(0, -4) + "AAAA";
    expect((await get("/me", forged)).statusCode).toBe(401);
    expect((await get("/me", "abc.def.ghi")).statusCode).toBe(401);
  });
});

describe("limite de requisições", () => {
  it("responde 429 após exceder as tentativas de login por IP", async () => {
    const limited = await buildApp({ rateLimit: true });
    await limited.ready();
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await limited.inject({ method: "POST", url: "/auth/login", payload: { email: "z@z.com", password: "x" } })).statusCode;
    }
    expect(last).toBe(429);
    await limited.close();
  });
});
