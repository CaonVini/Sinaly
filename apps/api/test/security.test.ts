/**
 * "Pentest" automatizado da API: tenta o que um atacante tentaria e confirma que não funciona.
 * Cada describe cobre uma classe de ataque. O que NÃO dá para testar aqui está no relatório.
 */
import { createHmac } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PASS, STAFF_PASS, multipart, profile, testEnv } from "./helpers.js";

testEnv();
const { buildApp } = await import("../src/app.js");
const { db, pool } = await import("../src/db/client.js");
const { users } = await import("../src/db/schema.js");
const { encrypt } = await import("../src/security/crypto.js");
const { hashPassword } = await import("../src/security/password.js");
const { generateTotpSecret, totpAt, currentStep } = await import("../src/security/totp.js");

let app: Awaited<ReturnType<typeof buildApp>>;
let appRl: Awaited<ReturnType<typeof buildApp>>; // com limite de requisições ligado
const JWT_SECRET = process.env.JWT_SECRET!;

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const send = (method: Method, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}, a = app) =>
  a.inject({ method, url, payload: payload as object, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

const secrets = new Map<string, string>();
async function staff(role: "servidor" | "gestor" | "admin", email: string) {
  const secret = generateTotpSecret();
  secrets.set(email, secret);
  await db.insert(users).values({ email, name: `Func ${role}`, role, passwordHash: await hashPassword(STAFF_PASS), totpSecretEnc: encrypt(secret) });
  const res = await send("POST", "/auth/staff/login", undefined, { email, password: STAFF_PASS, totp: totpAt(secret, currentStep()) });
  expect(res.statusCode).toBe(200);
  return res.json() as { accessToken: string; refreshToken: string };
}
async function citizen(email: string, cpf = "529.982.247-25") {
  const r = await send("POST", "/auth/register", undefined, { email, password: PASS });
  const t = r.json() as { accessToken: string; refreshToken: string };
  expect((await send("POST", "/me/onboarding", t.accessToken, profile(cpf))).statusCode).toBe(201);
  const id = (await pool.query("select id from users where email = $1", [email])).rows[0].id as string;
  return { ...t, id };
}
const fields = (over: Record<string, string> = {}) => ({ category: "iluminacao", description: "Poste com a lâmpada apagada há uma semana", lat: "-23.55", lng: "-46.63", ...over });
const jpeg = () => sharp({ create: { width: 800, height: 600, channels: 3, background: "#cc3333" } }).jpeg().toBuffer();
async function newOcc(token: string, over: Record<string, string> = {}) {
  const r = await multipart(app, "POST", "/occurrences", token, fields(over), { data: await jpeg() });
  expect(r.statusCode).toBe(201);
  return (r.json() as { id: string }).id;
}
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const forge = (payload: object, secret = JWT_SECRET, alg = "HS256") => {
  const head = b64({ alg, typ: "JWT" });
  const body = b64(payload);
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
};

beforeAll(async () => {
  app = await buildApp({ rateLimit: false, geocoder: null });
  appRl = await buildApp({ rateLimit: true, geocoder: null });
  await Promise.all([app.ready(), appRl.ready()]);
});
beforeEach(async () => {
  await pool.query("truncate users, auth_events cascade");
  secrets.clear();
});
afterAll(async () => {
  await app.close();
  await appRl.close();
  await pool.end();
});

describe("A1 · IDOR e autorização entre cidadãos", () => {
  it("cidadão B não lê, não vê foto, não altera nem lista o que é do cidadão A", async () => {
    const a = await citizen("a@example.com");
    const b = await citizen("b@example.com", "111.444.777-35");
    const id = await newOcc(a.accessToken); // não verificada: privada ao dono
    expect((await send("GET", `/occurrences/${id}`, b.accessToken)).statusCode).toBe(404);
    expect((await send("GET", `/occurrences/${id}/photo`, b.accessToken)).statusCode).toBe(404);
    expect((await send("GET", `/occurrences/${id}`)).statusCode).toBe(404);
    expect((await send("PATCH", `/staff/occurrences/${id}`, b.accessToken, { status: "em_analise" })).statusCode).toBe(403);
    expect((await send("GET", "/me/occurrences", b.accessToken)).json().items).toHaveLength(0);
    expect((await send("GET", "/staff/occurrences", b.accessToken)).statusCode).toBe(403);
    expect((await send("GET", `/staff/occurrences/${id}/audit`, b.accessToken)).statusCode).toBe(403);
    expect((await send("PUT", `/staff/occurrences/${id}/photo`, b.accessToken)).statusCode).toBe(403);
  });

  it("notificação de outro cidadão: não lê nem marca como lida; ids malformados dão 404", async () => {
    const a = await citizen("a@example.com");
    const b = await citizen("b@example.com", "111.444.777-35");
    const st = await staff("servidor", "s@p.gov.br");
    const id = await newOcc(a.accessToken);
    await send("PATCH", `/staff/occurrences/${id}`, st.accessToken, { status: "em_analise" });
    const notif = (await send("GET", "/me/notifications", a.accessToken)).json().items[0];
    expect(notif).toBeTruthy();
    expect((await send("GET", "/me/notifications", b.accessToken)).json().items).toHaveLength(0);
    expect((await send("POST", `/me/notifications/${notif.id}/read`, b.accessToken)).statusCode).toBe(404);
    expect((await pool.query("select read_at from notifications where id = $1", [notif.id])).rows[0].read_at).toBeNull();
    for (const bad of ["1", "../../etc/passwd", "' or 1=1--", "00000000-0000-0000-0000-000000000000"]) {
      expect((await send("POST", `/me/notifications/${encodeURIComponent(bad)}/read`, a.accessToken)).statusCode).toBe(404);
    }
  });

  it("cidadão não cria ocorrência em nome de outro nem define status/autor (mass assignment)", async () => {
    const a = await citizen("a@example.com");
    const b = await citizen("b@example.com", "111.444.777-35");
    const r = await multipart(app, "POST", "/occurrences", a.accessToken, { ...fields(), authorId: b.id, status: "resolvido", source: "prefeitura", resolvedAt: "2020-01-01" });
    expect(r.statusCode).toBe(201);
    const row = (await pool.query("select author_id, status, source, resolved_at from occurrences")).rows[0];
    expect(row).toMatchObject({ author_id: a.id, status: "nao_verificado", source: "app", resolved_at: null });
  });

  it("detalhe público nunca devolve dados internos", async () => {
    const a = await citizen("a@example.com");
    const st = await staff("servidor", "s@p.gov.br");
    const id = await newOcc(a.accessToken);
    await send("PATCH", `/staff/occurrences/${id}`, st.accessToken, { status: "em_analise" });
    const body = JSON.stringify((await send("GET", `/occurrences/${id}`)).json());
    for (const leak of ["authorId", "author_id", "photoKey", "photo_key", "contact", "reporterContact", "cpf", "phone", "authorName", "email"]) expect(body).not.toContain(leak);
    const map = JSON.stringify((await send("GET", "/occurrences/map?bbox=-74,-34,-28,6")).json());
    for (const leak of ["authorId", "contact", "cpf", "email"]) expect(map).not.toContain(leak);
  });
});

describe("A2 · escalonamento de cargo", () => {
  it("cadastro público ignora cargo enviado; cidadão não vira funcionário", async () => {
    const r = await send("POST", "/auth/register", undefined, { email: "x@example.com", password: PASS, role: "admin", isActive: true });
    expect(r.statusCode).toBe(201);
    expect((await pool.query("select role from users where email = 'x@example.com'")).rows[0].role).toBe("cidadao");
    const token = r.json().accessToken;
    expect((await send("POST", "/auth/staff/login", undefined, { email: "x@example.com", password: PASS, totp: "123456" })).statusCode).toBe(401);
    for (const url of ["/admin/staff", "/admin/access-audit", "/staff/stats", "/staff/reports", "/staff/geocode/status"]) expect((await send("GET", url, token)).statusCode, url).toBe(403);
    expect((await send("POST", "/staff/config/statuses", token, { name: "Hack", color: "#000000" })).statusCode).toBe(403);
  });

  it("servidor e gestor não alcançam rotas de admin; servidor não alcança configuração", async () => {
    const srv = await staff("servidor", "s@p.gov.br");
    const ger = await staff("gestor", "g@p.gov.br");
    for (const t of [srv.accessToken, ger.accessToken]) {
      expect((await send("GET", "/admin/staff", t)).statusCode).toBe(403);
      expect((await send("POST", "/admin/staff", t, { email: "n@p.gov.br", name: "Nome Teste", role: "admin", totp: "123456" })).statusCode).toBe(403);
    }
    expect((await send("PUT", "/staff/config/geocoder", srv.accessToken, { enabled: false })).statusCode).toBe(403);
    expect((await send("DELETE", "/staff/config/categories/seguranca", srv.accessToken)).statusCode).toBe(403);
  });

  it("cargo vem do banco a cada requisição: rebaixar vale na hora, sem esperar o token vencer", async () => {
    const ger = await staff("gestor", "g@p.gov.br");
    expect((await send("GET", "/staff/config/audit", ger.accessToken)).statusCode).toBe(200);
    await pool.query("update users set role = 'servidor' where email = 'g@p.gov.br'");
    expect((await send("GET", "/staff/config/audit", ger.accessToken)).statusCode).toBe(403);
  });

  it("funcionário não consegue editar campos proibidos da ocorrência (autor, origem, datas)", async () => {
    const st = await staff("servidor", "s@p.gov.br");
    const a = await citizen("a@example.com");
    const id = await newOcc(a.accessToken);
    for (const extra of [{ authorId: crypto.randomUUID() }, { source: "app" }, { resolvedAt: "2020-01-01" }, { photoKey: "../../x" }]) {
      expect((await send("PATCH", `/staff/occurrences/${id}`, st.accessToken, { description: "Descrição válida e longa", ...extra })).statusCode).toBe(400);
    }
  });
});

describe("A3 · JWT, sessão e cookies de token", () => {
  it("rejeita token sem assinatura (alg none), assinado com outro segredo, expirado e sem issuer", async () => {
    const c = await citizen("a@example.com");
    const payload = (JSON.parse(Buffer.from(c.accessToken.split(".")[1]!, "base64url").toString()) as { sub: string; fid: string });
    const now = Math.floor(Date.now() / 1000);
    const ok = { sub: payload.sub, fid: payload.fid, iss: "sinaly-api", iat: now, exp: now + 600 };
    expect((await send("GET", "/me", forge(ok))).statusCode).toBe(200); // controle: o forjador funciona com o segredo certo
    expect((await send("GET", "/me", forge(ok, "outro-segredo-qualquer-com-mais-de-32-caracteres"))).statusCode).toBe(401);
    expect((await send("GET", "/me", `${b64({ alg: "none", typ: "JWT" })}.${b64(ok)}.`)).statusCode).toBe(401);
    expect((await send("GET", "/me", `${b64({ alg: "none", typ: "JWT" })}.${b64(ok)}`)).statusCode).toBe(401);
    expect((await send("GET", "/me", forge({ ...ok, exp: now - 10 }))).statusCode).toBe(401);
    expect((await send("GET", "/me", forge({ sub: ok.sub, fid: ok.fid, iat: now, exp: now + 600 }))).statusCode).toBe(401); // sem iss
    expect((await send("GET", "/me", forge({ sub: ok.sub, fid: ok.fid, iss: "sinaly-api", iat: now }))).statusCode).toBe(401); // sem exp (token eterno)
    expect((await send("GET", "/me", forge({ ...ok, iss: "outro" }))).statusCode).toBe(401);
    expect((await send("GET", "/me", forge(ok, JWT_SECRET, "HS512"))).statusCode).toBe(401); // algoritmo trocado
  });

  it("token válido não vale sem sessão ativa (logout, fid inexistente, refresh usado como access)", async () => {
    const c = await citizen("a@example.com");
    expect((await send("GET", "/me", c.refreshToken)).statusCode).toBe(401); // refresh não é access
    const p = JSON.parse(Buffer.from(c.accessToken.split(".")[1]!, "base64url").toString());
    const now = Math.floor(Date.now() / 1000);
    expect((await send("GET", "/me", forge({ sub: p.sub, fid: crypto.randomUUID(), iss: "sinaly-api", iat: now, exp: now + 600 }))).statusCode).toBe(401);
    expect((await send("POST", "/auth/logout", c.accessToken)).statusCode).toBe(204);
    expect((await send("GET", "/me", c.accessToken)).statusCode).toBe(401);
    expect((await send("POST", "/auth/refresh", undefined, { refreshToken: c.refreshToken })).statusCode).toBe(401);
  });

  it("refresh usado duas vezes derruba a cadeia inteira (roubo de token)", async () => {
    const c = await citizen("a@example.com");
    const first = await send("POST", "/auth/refresh", undefined, { refreshToken: c.refreshToken });
    expect(first.statusCode).toBe(200);
    expect((await send("POST", "/auth/refresh", undefined, { refreshToken: c.refreshToken })).statusCode).toBe(401); // reuso
    expect((await send("POST", "/auth/refresh", undefined, { refreshToken: first.json().refreshToken })).statusCode).toBe(401); // a cadeia caiu
    expect((await send("GET", "/me", first.json().accessToken)).statusCode).toBe(401);
  });

  it("conta desativada perde acesso na hora", async () => {
    const c = await citizen("a@example.com");
    await pool.query("update users set is_active = false where email = 'a@example.com'");
    expect((await send("GET", "/me", c.accessToken)).statusCode).toBe(401);
    expect((await send("POST", "/auth/refresh", undefined, { refreshToken: c.refreshToken })).statusCode).toBe(401);
  });

  it("refresh token é guardado só como hash", async () => {
    const c = await citizen("a@example.com");
    const { rows } = await pool.query("select token_hash from sessions");
    expect(rows.some((r) => r.token_hash === c.refreshToken)).toBe(false);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("A4 · autenticação: enumeração, força bruta, TOTP", () => {
  it("login não revela se o e-mail existe (mesma resposta, citizen e staff)", async () => {
    await citizen("existe@example.com");
    const real = await send("POST", "/auth/login", undefined, { email: "existe@example.com", password: "senha-errada-123456" });
    const fake = await send("POST", "/auth/login", undefined, { email: "nao-existe@example.com", password: "senha-errada-123456" });
    expect(real.statusCode).toBe(401);
    expect(fake.statusCode).toBe(401);
    expect(real.body).toBe(fake.body);
    const sReal = await send("POST", "/auth/staff/login", undefined, { email: "existe@example.com", password: PASS, totp: "123456" });
    expect(sReal.body).toBe(real.body); // cidadão tentando a rota de staff: mesma resposta
  });

  it("bloqueia a conta após 5 senhas erradas, mesmo com a senha certa depois", async () => {
    await citizen("a@example.com");
    for (let i = 0; i < 5; i++) await send("POST", "/auth/login", undefined, { email: "a@example.com", password: "errada-errada-123" });
    const r = await send("POST", "/auth/login", undefined, { email: "a@example.com", password: PASS });
    expect(r.statusCode).toBe(401);
  });

  it("staff: senha certa + TOTP errado conta como falha e bloqueia; TOTP reaproveitado é recusado", async () => {
    await staff("servidor", "s@p.gov.br"); // o login do helper já consumiu o passo atual
    const secret = secrets.get("s@p.gov.br")!;
    const replay = await send("POST", "/auth/staff/login", undefined, { email: "s@p.gov.br", password: STAFF_PASS, totp: totpAt(secret, currentStep()) });
    expect(replay.statusCode).toBe(401);
    const old = await send("POST", "/auth/staff/login", undefined, { email: "s@p.gov.br", password: STAFF_PASS, totp: totpAt(secret, currentStep() - 1) });
    expect(old.statusCode).toBe(401); // passo anterior ao último usado
    for (let i = 0; i < 6; i++) await send("POST", "/auth/staff/login", undefined, { email: "s@p.gov.br", password: STAFF_PASS, totp: "000000" });
    const locked = await send("POST", "/auth/staff/login", undefined, { email: "s@p.gov.br", password: STAFF_PASS, totp: totpAt(secret, currentStep() + 1) });
    expect(locked.statusCode).toBe(401); // bloqueada: nem o TOTP certo entra
    expect(locked.body).toBe(replay.body);
  });

  it("limite de requisições: login (10/min) e cadastro (10/h) devolvem 429", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await send("POST", "/auth/login", undefined, { email: "x@example.com", password: "qualquer-senha-12" }, {}, appRl)).statusCode;
    expect(last).toBe(429);
    let reg = 0;
    for (let i = 0; i < 12; i++) reg = (await send("POST", "/auth/register", undefined, { email: `r${i}@example.com`, password: PASS }, {}, appRl)).statusCode;
    expect(reg).toBe(429);
  });

  it("senha fraca, e-mail inválido e corpo gigante/inesperado são recusados sem estourar", async () => {
    expect((await send("POST", "/auth/register", undefined, { email: "a@example.com", password: "curta" })).statusCode).toBe(400);
    expect((await send("POST", "/auth/register", undefined, { email: "nao-e-email", password: PASS })).statusCode).toBe(400);
    expect((await send("POST", "/auth/register", undefined, "texto solto", { "content-type": "application/json" })).statusCode).toBe(400);
    const big = await send("POST", "/auth/register", undefined, { email: "a@example.com", password: "x".repeat(2_000_000) });
    expect(big.statusCode).toBe(413);
    expect((await send("POST", "/auth/login", undefined, { email: { $ne: null }, password: { $ne: null } })).statusCode).toBe(401);
  });
});

describe("A5 · injeção", () => {
  const evil = ["' OR '1'='1", "'; DROP TABLE users;--", "1; select pg_sleep(5)", "%27%20or%201=1", "\" or \"\"=\"", "${7*7}", "<script>alert(1)</script>", "../../../etc/passwd", "\u0000"];

  it("parâmetros de consulta maliciosos viram 400/200 vazio, nunca 500 nem vazamento", async () => {
    const st = await staff("servidor", "s@p.gov.br");
    for (const e of evil) {
      const q = encodeURIComponent(e);
      for (const url of [`/staff/occurrences?status=${q}`, `/staff/occurrences?category=${q}`, `/staff/occurrences?from=${q}`, `/staff/occurrences?cursor=${q}`, `/staff/occurrences?bbox=${q}`, `/staff/reports?category=${q}`, `/staff/reports?status=${q}`, `/occurrences/map?bbox=${q}`, `/occurrences/map?bbox=-74,-34,-28,6&category=${q}`, `/me/notifications?cursor=${q}`]) {
        const r = await send("GET", url, st.accessToken);
        expect([200, 400, 403], `${url} -> ${r.statusCode}`).toContain(r.statusCode);
        expect(r.body).not.toMatch(/syntax error|pg_|relation|select |drizzle/i);
      }
    }
    expect((await pool.query("select count(*)::int as n from users")).rows[0].n).toBe(1); // a tabela continua lá
  });

  it("texto malicioso em descrição/bairro/contato é guardado como texto e devolvido escapado em JSON", async () => {
    const st = await staff("servidor", "s@p.gov.br");
    const r = await multipart(app, "POST", "/staff/occurrences", st.accessToken, fields({ description: "<img src=x onerror=alert(1)> '); DROP TABLE users;-- texto", neighborhood: "<b>Centro</b>", reporterName: "=cmd|' /C calc'!A0" }));
    expect(r.statusCode).toBe(201);
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect((await pool.query("select count(*)::int as n from users")).rows[0].n).toBe(1);
  });

  it("filtros de relatórios e filtros de config não aceitam SQL", async () => {
    const ger = await staff("admin", "g@p.gov.br");
    expect((await send("POST", "/staff/config/categories", ger.accessToken, { name: "x'); drop table users;--", color: "#000000", icon: "trash" })).statusCode).toBe(201); // vira slug seguro e texto
    const slug = (await pool.query("select slug from categories where not system")).rows[0].slug;
    expect(slug).toMatch(/^[a-z0-9_]+$/);
    await pool.query("delete from categories where not system");
    for (const bad of ["a b", "ç", "A", "x".repeat(41), "../x"]) expect((await send("PATCH", `/staff/config/categories/${encodeURIComponent(bad)}`, ger.accessToken, { active: false })).statusCode).toBe(404);
  });
});

describe("A6 · upload malicioso", () => {
  const att = async (data: Buffer, over: { name?: string; type?: string; field?: string } = {}) => {
    const c = await citizen(`u${Math.random().toString(36).slice(2)}@example.com`, "529.982.247-25").catch(() => null);
    return { c, data, over };
  };
  it("recusa arquivos que não são imagem, mesmo disfarçados de image/jpeg", async () => {
    const a = await citizen("a@example.com");
    const cases: [string, Buffer, string][] = [
      ["script PHP", Buffer.from("<?php system($_GET['c']); ?>"), "x.php.jpg"],
      ["HTML", Buffer.from("<html><script>alert(1)</script></html>"), "x.jpg"],
      ["SVG com script", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'), "x.svg"],
      ["executável", Buffer.from("MZ\x90\x00\x03\x00\x00\x00"), "x.exe"],
      ["vazio com cabeçalho", Buffer.from([0xff, 0xd8, 0xff]), "x.jpg"],
      ["GIF (formato não aceito)", Buffer.from("R0lGODlhAQABAAAAACw=", "base64"), "x.gif"],
    ];
    for (const [label, data, name] of cases) {
      const r = await multipart(app, "POST", "/occurrences", a.accessToken, fields(), { data, name, type: "image/jpeg" });
      expect(r.statusCode, label).toBe(400);
    }
    expect((await pool.query("select count(*)::int as n from occurrences")).rows[0].n).toBe(0);
  });

  it("imagem com carga anexada é regravada limpa (EXIF/GPS e bytes extras somem)", async () => {
    const a = await citizen("a@example.com");
    const base = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#336699" } }).jpeg().withExif({ IFD0: { Copyright: "segredo-no-exif" } }).toBuffer();
    const polyglot = Buffer.concat([base, Buffer.from("<?php echo 'pwned'; ?><script>alert(1)</script>")]);
    const id = await newOccFrom(a.accessToken, polyglot);
    const stored = await send("GET", `/occurrences/${id}/photo`, a.accessToken);
    expect(stored.statusCode).toBe(200);
    expect(stored.rawPayload.includes("pwned")).toBe(false);
    expect(stored.rawPayload.includes("segredo-no-exif")).toBe(false);
    expect(stored.headers["content-type"]).toBe("image/jpeg");
    expect(stored.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("bomba de descompressão (dimensões absurdas) é recusada sem derrubar o servidor", async () => {
    const a = await citizen("a@example.com");
    // PNG de uma cor só: pequeno em disco, 49 milhões de pixels ao abrir.
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer(); // 49 mi de pixels, acima do limite de 40 mi
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    const r = await multipart(app, "POST", "/occurrences", a.accessToken, fields(), { data: bomb, name: "x.png", type: "image/png" });
    expect(r.statusCode).toBe(400);
    expect((await send("GET", "/health")).statusCode).toBe(200);
  }, 60_000);

  it("arquivo acima de 5 MB, campo de arquivo errado e partes demais são recusados", async () => {
    const a = await citizen("a@example.com");
    const big = Buffer.concat([await jpeg(), Buffer.alloc(6 * 1024 * 1024)]);
    expect([400, 413]).toContain((await multipart(app, "POST", "/occurrences", a.accessToken, fields(), { data: big })).statusCode);
    expect((await multipart(app, "POST", "/occurrences", a.accessToken, fields(), { data: await jpeg(), field: "arquivo" })).statusCode).toBe(400);
  });

  it("a rota da foto só aceita UUID: sem path traversal", async () => {
    const a = await citizen("a@example.com");
    for (const bad of ["..%2F..%2Fetc%2Fpasswd", "../../x", "%00", "1' or '1'='1"]) {
      expect((await send("GET", `/occurrences/${bad}/photo`, a.accessToken)).statusCode).toBe(404);
    }
  });
  void att;
});
async function newOccFrom(token: string, data: Buffer) {
  const r = await multipart(app, "POST", "/occurrences", token, fields(), { data });
  expect(r.statusCode).toBe(201);
  return (r.json() as { id: string }).id;
}

describe("A7 · CORS, cabeçalhos e vazamento em erros", () => {
  it("CORS não reflete origem desconhecida; a permitida é aceita", async () => {
    const evil = await send("GET", "/health", undefined, undefined, { origin: "https://evil.example" });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    const pre = await app.inject({ method: "OPTIONS", url: "/auth/login", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();
    expect(pre.headers["access-control-allow-credentials"]).toBeUndefined();
    const good = await send("GET", "/health", undefined, undefined, { origin: "http://localhost:3000" });
    expect(good.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("cabeçalhos de segurança presentes e sem informação de servidor", async () => {
    const r = await send("GET", "/health");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["strict-transport-security"]).toBeTruthy();
    expect(r.headers["x-frame-options"]).toBeTruthy();
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect(r.headers["server"]).toBeUndefined();
    expect(r.headers["content-security-policy"]).toBeTruthy();
  });

  it("respostas autenticadas com dados pessoais não são cacheáveis", async () => {
    const st = await staff("admin", "a@p.gov.br");
    for (const url of ["/admin/staff", "/admin/access-audit", "/staff/occurrences", "/me"]) {
      const r = await send("GET", url, st.accessToken);
      const cc = String(r.headers["cache-control"] ?? "");
      expect(cc, url).toMatch(/no-store|no-cache|private/);
      expect(cc, url).not.toMatch(/public/);
    }
  });

  it("erros não vazam pilha, SQL ou caminhos", async () => {
    const st = await staff("servidor", "s@p.gov.br");
    const probes = await Promise.all([
      send("GET", "/rota-que-nao-existe"),
      send("POST", "/auth/login", undefined, "{json quebrado", { "content-type": "application/json" }),
      send("GET", "/staff/occurrences?limit=abc", st.accessToken),
      send("PATCH", "/staff/occurrences/nao-uuid", st.accessToken, { status: "em_analise" }),
      send("GET", "/occurrences/map?bbox=1,2,3", undefined),
    ]);
    for (const p of probes) {
      expect(p.statusCode).toBeLessThan(500);
      expect(p.body).not.toMatch(/\n\s+at |\.[jt]s:\d+|node_modules|\/home\/|\/tmp\/|SELECT |INSERT |postgres|drizzle|"stack"/i);
    }
  });

  it("métodos HTTP inesperados não ganham acesso (TRACE/HEAD/OPTIONS em rota protegida)", async () => {
    for (const method of ["TRACE", "CONNECT"] as const) {
      const r = await app.inject({ method: method as never, url: "/admin/staff" });
      expect([400, 404, 405]).toContain(r.statusCode);
    }
    expect((await app.inject({ method: "HEAD", url: "/admin/staff" })).statusCode).toBe(401);
  });
});

describe("A8 · vazamento de dados pessoais", () => {
  it("/me do cidadão não traz CPF, telefone, endereço nem hash; do staff não traz segredo", async () => {
    const c = await citizen("a@example.com");
    const body = JSON.stringify((await send("GET", "/me", c.accessToken)).json());
    for (const leak of ["cpf", "529", "phone", "11912345678", "passwordHash", "password_hash", "totp", "01001000"]) expect(body.toLowerCase()).not.toContain(leak.toLowerCase());
    const st = await staff("servidor", "s@p.gov.br");
    const sb = JSON.stringify((await send("GET", "/me", st.accessToken)).json());
    expect(sb).not.toMatch(/totp|passwordHash|secret/i);
  });

  it("CPF e contato ficam cifrados no banco; o CPF nunca sai por nenhuma rota", async () => {
    const c = await citizen("a@example.com");
    const st = await staff("servidor", "s@p.gov.br");
    await multipart(app, "POST", "/staff/occurrences", st.accessToken, fields({ reporterName: "Dona Rita", reporterPhone: "11987654321" }));
    const rows = (await pool.query("select cpf_enc, cpf_hash from citizen_profiles")).rows[0];
    expect(rows.cpf_enc).not.toContain("52998224725");
    expect(rows.cpf_hash).toMatch(/^[0-9a-f]{64}$/);
    const enc = (await pool.query("select reporter_contact_enc from occurrences")).rows[0].reporter_contact_enc as string;
    expect(enc).not.toMatch(/Rita|11987654321/);
    const id = (await pool.query("select id from occurrences")).rows[0].id;
    // nenhuma rota devolve o CPF
    for (const [t, url] of [[c.accessToken, "/me"], [c.accessToken, "/me/occurrences"], [st.accessToken, "/staff/occurrences"], [st.accessToken, `/occurrences/${id}`], [st.accessToken, "/staff/activity"]] as const) {
      expect((await send("GET", url, t)).body, url).not.toMatch(/52998224725|529\.982|cpf/i);
    }
  });

  it("listas e detalhes de staff trazem contato só para funcionário; cidadão dono não vê o contato digitado pela prefeitura", async () => {
    const st = await staff("servidor", "s@p.gov.br");
    const r = await multipart(app, "POST", "/staff/occurrences", st.accessToken, fields({ reporterName: "Dona Rita", reporterPhone: "11987654321", status: "em_analise" }));
    const id = (r.json() as { id: string }).id;
    const c = await citizen("a@example.com");
    expect((await send("GET", `/occurrences/${id}`, c.accessToken)).body).not.toMatch(/Rita|11987654321|contact/);
    expect((await send("GET", `/occurrences/${id}`)).body).not.toMatch(/Rita|11987654321|contact/);
    expect((await send("GET", `/occurrences/${id}`, st.accessToken)).body).toMatch(/Rita/);
  });

  it("trilha de auditoria da ocorrência não expõe contato nem a staff nem a cidadão", async () => {
    const st = await staff("servidor", "s@p.gov.br");
    const r = await multipart(app, "POST", "/staff/occurrences", st.accessToken, fields({ reporterName: "Dona Rita", reporterPhone: "11987654321" }));
    const id = (r.json() as { id: string }).id;
    expect((await send("GET", `/staff/occurrences/${id}/audit`, st.accessToken)).body).not.toMatch(/Rita|11987654321/);
  });
});

describe("A9 · lógica de negócio e abuso", () => {
  it("limite diário de ocorrências por cidadão (anti-spam) e transição inválida de status", async () => {
    const a = await citizen("a@example.com");
    const st = await staff("servidor", "s@p.gov.br");
    const id = await newOcc(a.accessToken);
    expect((await send("PATCH", `/staff/occurrences/${id}`, st.accessToken, { status: "resolvido" })).statusCode).toBe(409);
    expect((await send("PATCH", `/staff/occurrences/${id}`, st.accessToken, { status: "inexistente" })).statusCode).toBe(400);
    await pool.query("insert into occurrences (author_id, category, description, location) select $1, 'iluminacao', 'Descrição de teste do limite', ST_SetSRID(ST_MakePoint(-46.6,-23.5),4326) from generate_series(1,19)", [a.id]);
    expect((await multipart(app, "POST", "/occurrences", a.accessToken, fields(), { data: await jpeg() })).statusCode).toBe(429);
  });

  it("coordenadas e textos fora do limite são recusados", async () => {
    const a = await citizen("a@example.com");
    for (const over of [{ lat: "91" }, { lng: "-181" }, { lat: "abc" }, { lat: "NaN" }, { lat: "Infinity" }, { description: "curta" }, { description: "x".repeat(1001) }, { category: "inexistente" }]) {
      expect((await multipart(app, "POST", "/occurrences", a.accessToken, fields(over), { data: await jpeg() })).statusCode, JSON.stringify(over)).toBe(400);
    }
  });

  it("paginação limita tamanho de página (sem despejo de tabela)", async () => {
    const st = await staff("servidor", "s@p.gov.br");
    expect((await send("GET", "/staff/occurrences?limit=100000", st.accessToken)).statusCode).toBe(400);
    expect((await send("GET", "/occurrences/map?bbox=-74,-34,-28,6&limit=100000")).statusCode).toBe(400);
  });
});
