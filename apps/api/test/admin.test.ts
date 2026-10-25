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
const send = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, token?: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

const secrets = new Map<string, string>();
async function staff(role: "servidor" | "gestor" | "admin", email: string) {
  const secret = generateTotpSecret();
  secrets.set(email, secret);
  await db.insert(users).values({ email, name: `Func ${role}`, role, passwordHash: await hashPassword(STAFF_PASS), totpSecretEnc: encrypt(secret) });
  const res = await send("POST", "/auth/staff/login", undefined, { email, password: STAFF_PASS, totp: totpAt(secret, currentStep()) });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken as string;
}
/** Código TOTP novo para a confirmação (o do login já foi consumido; liberamos o passo como se tivesse passado 30 s). */
async function code(email: string) {
  await pool.query("update users set totp_last_step = null where email = $1", [email]);
  return totpAt(secrets.get(email)!, currentStep());
}
async function citizen(email: string, cpf = "529.982.247-25") {
  const r = await send("POST", "/auth/register", undefined, { email, password: PASS });
  const token = r.json().accessToken as string;
  await send("POST", "/me/onboarding", token, profile(cpf));
  return token;
}
const occFields = (over: Record<string, string> = {}) => ({ category: "iluminacao", description: "Poste com a lâmpada apagada há uma semana", lat: "-23.55", lng: "-46.63", ...over });
const audit = async (action?: string) => (await pool.query(`select * from access_audit ${action ? "where action = $1" : ""} order by id`, action ? [action] : [])).rows;

beforeAll(async () => {
  app = await buildApp({ rateLimit: false, geocoder: null });
  await app.ready();
});
beforeEach(async () => {
  await pool.query("truncate users, auth_events cascade");
  secrets.clear();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("cargos e gestão de equipe", () => {
  it("só admin acessa /admin; servidor, gestor, cidadão e anônimo não", async () => {
    const adm = await staff("admin", "adm@p.gov.br");
    const ger = await staff("gestor", "ger@p.gov.br");
    const srv = await staff("servidor", "srv@p.gov.br");
    const cit = await citizen("c@example.com");
    for (const [t, expected] of [[undefined, 401], [cit, 403], [srv, 403], [ger, 403], [adm, 200]] as const) {
      expect((await send("GET", "/admin/staff", t)).statusCode, String(expected)).toBe(expected);
      expect((await send("GET", "/admin/access-audit", t)).statusCode).toBe(expected);
    }
    expect((await send("POST", "/admin/staff", ger, { email: "x@p.gov.br", name: "Fulano", role: "servidor", totp: "123456" })).statusCode).toBe(403);
    expect((await send("PATCH", `/admin/staff/${crypto.randomUUID()}`, srv, { active: false, totp: "123456" })).statusCode).toBe(403);
  });

  it("gestor continua com Configuração; servidor não; admin também", async () => {
    const adm = await staff("admin", "adm@p.gov.br");
    const ger = await staff("gestor", "ger@p.gov.br");
    const srv = await staff("servidor", "srv@p.gov.br");
    const body = { name: "Lixo", color: "#16a34a", icon: "trash" };
    expect((await send("POST", "/staff/config/categories", srv, body)).statusCode).toBe(403);
    expect((await send("POST", "/staff/config/categories", ger, body)).statusCode).toBe(201);
    expect((await send("POST", "/staff/config/categories", adm, { ...body, name: "Lixo 2" })).statusCode).toBe(201);
    await pool.query("delete from categories where not system");
  });

  it("criar conta exige TOTP do admin, devolve credenciais uma vez e a conta entra com senha + TOTP", async () => {
    const adm = await staff("admin", "adm@p.gov.br");
    const body = { email: "nova@p.gov.br", name: "Nova Pessoa", role: "servidor" };
    expect((await send("POST", "/admin/staff", adm, body)).statusCode).toBe(400); // sem código
    expect((await send("POST", "/admin/staff", adm, { ...body, totp: "000000" })).statusCode).toBe(403);
    const ok = await send("POST", "/admin/staff", adm, { ...body, totp: await code("adm@p.gov.br") });
    expect(ok.statusCode).toBe(201);
    expect(ok.headers["cache-control"]).toMatch(/no-store/);
    const { user, credentials } = ok.json();
    expect(user).toMatchObject({ email: "nova@p.gov.br", role: "servidor", isActive: true });
    expect(JSON.stringify(user)).not.toMatch(/passwordHash|totpSecret/);
    // login do novo funcionário com as credenciais recebidas
    const login = await send("POST", "/auth/staff/login", undefined, { email: "nova@p.gov.br", password: credentials.password, totp: totpAt(credentials.totpSecret, currentStep()) });
    expect(login.statusCode).toBe(200);
    expect(login.json().role).toBe("servidor");
    // segredo não vai para auditoria nem para a lista
    const log = JSON.stringify(await audit());
    expect(log).not.toContain(credentials.password);
    expect(log).not.toContain(credentials.totpSecret);
    expect(JSON.stringify((await send("GET", "/admin/staff", adm)).json())).not.toContain(credentials.password);
    // e-mail repetido
    expect((await send("POST", "/admin/staff", adm, { ...body, totp: await code("adm@p.gov.br") })).statusCode).toBe(409);
    // papel inválido (cidadão não é cargo de equipe) e campo extra
    expect((await send("POST", "/admin/staff", adm, { ...body, email: "y@p.gov.br", role: "cidadao", totp: await code("adm@p.gov.br") })).statusCode).toBe(400);
    expect((await send("POST", "/admin/staff", adm, { ...body, email: "z@p.gov.br", isActive: false, totp: await code("adm@p.gov.br") })).statusCode).toBe(400);
  });

  it("código TOTP não pode ser reaproveitado na confirmação", async () => {
    const adm = await staff("admin", "adm@p.gov.br");
    const c = await code("adm@p.gov.br");
    const body = (email: string) => ({ email, name: "Pessoa Teste", role: "servidor", totp: c });
    expect((await send("POST", "/admin/staff", adm, body("a1@p.gov.br"))).statusCode).toBe(201);
    expect((await send("POST", "/admin/staff", adm, body("a2@p.gov.br"))).statusCode).toBe(403); // mesmo código = replay
    const fails = (await pool.query("select count(*)::int as n from auth_events where event = 'stepup_failed'")).rows[0].n;
    expect(fails).toBe(1);
  });

  it("trocar cargo e desativar derrubam as sessões; não mexe em si mesmo nem em cidadão", async () => {
    const adm = await staff("admin", "adm@p.gov.br");
    const srvToken = await staff("servidor", "srv@p.gov.br");
    const cit = await citizen("c@example.com");
    const srvId = (await pool.query("select id from users where email = 'srv@p.gov.br'")).rows[0].id;
    const admId = (await pool.query("select id from users where email = 'adm@p.gov.br'")).rows[0].id;
    const citId = (await pool.query("select id from users where email = 'c@example.com'")).rows[0].id;
    void cit;

    expect((await send("PATCH", `/admin/staff/${admId}`, adm, { active: false, totp: await code("adm@p.gov.br") })).statusCode).toBe(409); // si mesmo
    expect((await send("PATCH", `/admin/staff/${citId}`, adm, { role: "admin", totp: await code("adm@p.gov.br") })).statusCode).toBe(404); // cidadão: fora do alcance
    expect((await send("GET", "/staff/stats", srvToken)).statusCode).toBe(200);

    const up = await send("PATCH", `/admin/staff/${srvId}`, adm, { role: "gestor", totp: await code("adm@p.gov.br") });
    expect(up.statusCode).toBe(200);
    expect(up.json().role).toBe("gestor");
    expect((await send("GET", "/staff/stats", srvToken)).statusCode).toBe(401); // sessão antiga encerrada

    const off = await send("PATCH", `/admin/staff/${srvId}`, adm, { active: false, totp: await code("adm@p.gov.br") });
    expect(off.json().isActive).toBe(false);
    const login = await send("POST", "/auth/staff/login", undefined, { email: "srv@p.gov.br", password: STAFF_PASS, totp: totpAt(secrets.get("srv@p.gov.br")!, currentStep() + 1) });
    expect(login.statusCode).toBe(401); // conta desativada não entra

    const entries = await audit("staff.update");
    expect(entries).toHaveLength(2);
    expect(entries[0].details.changes.role).toEqual({ from: "servidor", to: "gestor" });
    expect(entries[1].details.changes.active).toEqual({ from: true, to: false });
  });

  it("redefinir acesso gera nova senha e novo TOTP, invalida os antigos e encerra sessões", async () => {
    const adm = await staff("admin", "adm@p.gov.br");
    const srvToken = await staff("servidor", "srv@p.gov.br");
    const srvId = (await pool.query("select id from users where email = 'srv@p.gov.br'")).rows[0].id;
    const oldSecret = secrets.get("srv@p.gov.br")!;
    const res = await send("POST", `/admin/staff/${srvId}/reset`, adm, { totp: await code("adm@p.gov.br") });
    expect(res.statusCode).toBe(200);
    const { credentials } = res.json();
    expect((await send("GET", "/staff/stats", srvToken)).statusCode).toBe(401);
    const bad = await send("POST", "/auth/staff/login", undefined, { email: "srv@p.gov.br", password: STAFF_PASS, totp: totpAt(oldSecret, currentStep()) });
    expect(bad.statusCode).toBe(401);
    // a falha acima conta para o bloqueio; limpamos só para provar o login com o acesso novo
    await pool.query("update users set failed_login_attempts = 0, locked_until = null where email = 'srv@p.gov.br'");
    const good = await send("POST", "/auth/staff/login", undefined, { email: "srv@p.gov.br", password: credentials.password, totp: totpAt(credentials.totpSecret, currentStep()) });
    expect(good.statusCode).toBe(200);
    expect((await send("POST", `/admin/staff/${(await pool.query("select id from users where email = 'adm@p.gov.br'")).rows[0].id}/reset`, adm, { totp: await code("adm@p.gov.br") })).statusCode).toBe(409);
  });
});

describe("LGPD: trilha de acessos", () => {
  it("registra leitura de detalhe, lista, foto, auditoria da ocorrência e exportação, com ator, IP e ids", async () => {
    const srv = await staff("servidor", "srv@p.gov.br");
    const adm = await staff("admin", "adm@p.gov.br");
    const created = await multipart(app, "POST", "/staff/occurrences", srv, occFields({ reporterName: "Dona Rita", reporterPhone: "11912345678" }));
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    await send("GET", `/occurrences/${id}`, srv);
    await send("GET", "/staff/occurrences?limit=10", srv);
    await send("GET", `/staff/occurrences/${id}/audit`, srv);
    await send("GET", "/staff/activity", srv);
    expect((await send("POST", "/staff/audit/export", srv, { count: 1, filters: { status: "em_analise" } })).statusCode).toBe(204);
    expect((await send("POST", "/staff/audit/export", srv, { count: -1 })).statusCode).toBe(400);

    const rows = await audit();
    expect(rows.map((r) => r.action)).toEqual(["occurrence.view", "occurrence.list", "occurrence.audit_view", "activity.view", "occurrence.export"]);
    expect(rows[0]).toMatchObject({ subject_type: "occurrence", subject_id: id, actor_role: "servidor" });
    expect(rows[0].details).toMatchObject({ source: "prefeitura", withContact: true });
    expect(rows[1].details.ids).toEqual([id]);
    expect(rows[1].details.withContact).toBe(1);
    expect(rows[4].details).toMatchObject({ count: 1, filters: { status: "em_analise" } });
    expect(rows.every((r) => r.ip)).toBe(true);
    // o contato nunca vai para a trilha em texto aberto
    expect(JSON.stringify(rows)).not.toMatch(/Dona Rita|11912345678/);

    // cidadão lendo a própria ocorrência pública NÃO gera registro de staff; anônimo também não
    const before = (await audit()).length;
    await send("GET", `/occurrences/${id}`);
    expect((await audit()).length).toBe(before);

    // admin lê a trilha e isso também fica registrado
    const log = await send("GET", "/admin/access-audit?limit=3", adm);
    expect(log.statusCode).toBe(200);
    expect(log.json().items).toHaveLength(3);
    expect(log.json().nextCursor).toBeTruthy();
    const page2 = await send("GET", `/admin/access-audit?cursor=${log.json().nextCursor}&limit=50`, adm);
    expect(page2.json().items.length).toBeGreaterThan(0);
    expect((await audit("access_audit.view")).length).toBe(2);
    expect((await send("GET", "/admin/access-audit?cursor=lixo", adm)).statusCode).toBe(400);
    expect((await send("GET", "/admin/access-audit?action=x'--", adm)).statusCode).toBe(400);
  });

  it("registra foto de tamanho cheio (não miniatura) e é imutável no banco", async () => {
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#cc3333" } }).jpeg().toBuffer();
    const srv = await staff("servidor", "srv@p.gov.br");
    const created = await multipart(app, "POST", "/staff/occurrences", srv, occFields(), { data: jpeg });
    const id = (created.json() as { id: string }).id;
    await send("GET", `/occurrences/${id}/photo?size=thumb`, srv);
    expect(await audit("occurrence.photo")).toHaveLength(0);
    await send("GET", `/occurrences/${id}/photo`, srv);
    expect(await audit("occurrence.photo")).toHaveLength(1);
    await expect(pool.query("update access_audit set action = 'x'")).rejects.toThrow();
    await expect(pool.query("delete from access_audit")).rejects.toThrow();
  });

  it("falha ao gravar a trilha derruba a leitura (nada é entregue sem registro)", async () => {
    const srv = await staff("servidor", "srv@p.gov.br");
    const created = await multipart(app, "POST", "/staff/occurrences", srv, occFields({ reporterName: "Dona Rita", reporterPhone: "11912345678" }));
    const id = (created.json() as { id: string }).id;
    await pool.query("alter table access_audit rename to access_audit_off");
    try {
      const res = await send("GET", `/occurrences/${id}`, srv);
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toMatch(/Dona Rita|11912345678|access_audit/);
    } finally {
      await pool.query("alter table access_audit_off rename to access_audit");
    }
  });
});
