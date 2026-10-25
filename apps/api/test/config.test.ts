import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ??= "j".repeat(48);
process.env.CPF_HASH_PEPPER ??= "p".repeat(48);
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "sinaly-uploads-"));
if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL apontando para um banco de TESTE");

const { buildApp } = await import("../src/app.js");
const { db, pool } = await import("../src/db/client.js");
const { users } = await import("../src/db/schema.js");
const { invalidateMeta } = await import("../src/meta.js");
const { invalidateSettings } = await import("../src/settings.js");
const { encrypt } = await import("../src/security/crypto.js");
const { hashPassword } = await import("../src/security/password.js");
const { generateTotpSecret, totpAt, currentStep } = await import("../src/security/totp.js");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
const geocoded: [number, number][] = [];
let geocoderAnswer: string | null = "Centro";

const send = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, token?: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function staff(role: "servidor" | "gestor" | "admin", email: string) {
  const secret = generateTotpSecret();
  await db.insert(users).values({ email, name: `Func ${role}`, role, passwordHash: await hashPassword("senha-do-funcionario-forte"), totpSecretEnc: encrypt(secret) });
  const res = await send("POST", "/auth/staff/login", undefined, { email, password: "senha-do-funcionario-forte", totp: totpAt(secret, currentStep()) });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken as string;
}
async function citizen(email: string) {
  const res = await send("POST", "/auth/register", undefined, { email, password: "senha-bem-longa-123" });
  await send("POST", "/me/onboarding", res.json().accessToken, {
    firstName: "Maria", lastName: "da Silva", phone: "11912345678", cpf: "529.982.247-25",
    address: { cep: "01001000", street: "Praça da Sé", number: "10", neighborhood: "Sé", city: "São Paulo", state: "SP" },
  });
  return res.json().accessToken as string;
}
async function multipartCreate(path: string, token: string, fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = new Response(fd);
  return app.inject({ method: "POST", url: path, payload: Buffer.from(await res.arrayBuffer()), headers: { authorization: `Bearer ${token}`, "content-type": res.headers.get("content-type")! } });
}
const occ = (over: Record<string, string> = {}) => ({ category: "iluminacao", description: "Poste com a lâmpada apagada há uma semana", lat: "-23.55", lng: "-46.63", ...over });

beforeAll(async () => {
  app = await buildApp({
    rateLimit: false,
    geocoder: async (lat, lng) => {
      geocoded.push([lat, lng]);
      return geocoderAnswer;
    },
  });
  await app.ready();
});
beforeEach(async () => {
  await pool.query("truncate users, auth_events cascade");
  geocoded.length = 0;
  geocoderAnswer = "Centro";
});
afterEach(async () => {
  // Remove o que os testes criaram, mantendo os dados do sistema.
  await pool.query("truncate users, auth_events cascade");
  await pool.query("delete from statuses where not system");
  await pool.query("delete from categories where not system");
  invalidateMeta();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("GET /meta", () => {
  it("é público e traz os 5 status e 5 categorias do sistema", async () => {
    const res = await send("GET", "/meta");
    expect(res.statusCode).toBe(200);
    const meta = res.json();
    expect(meta.statuses.map((s: { slug: string }) => s.slug)).toEqual(["nao_verificado", "em_analise", "em_atendimento", "resolvido", "recusado"]);
    expect(meta.categories).toHaveLength(5);
    expect(meta.resolvedVisibleDays).toBe(5);
  });
});

describe("configuração: permissões", () => {
  it("só o admin altera; gestor e servidor só consultam; cidadão 403, anônimo 401", async () => {
    const srv = await staff("servidor", "s@prefeitura.gov.br");
    const cit = await citizen("c@example.com");
    const body = { name: "Lixo", color: "#16a34a", icon: "trash" };
    expect((await send("POST", "/staff/config/categories", undefined, body)).statusCode).toBe(401);
    expect((await send("POST", "/staff/config/categories", srv, body)).statusCode).toBe(403);
    expect((await send("POST", "/staff/config/categories", cit, body)).statusCode).toBe(403);
    expect((await send("POST", "/staff/geocode/backfill", srv)).statusCode).toBe(403);
    expect((await send("GET", "/staff/config/audit", srv)).statusCode).toBe(403);

    // gestor consulta (histórico, situação do bairro automático), mas toda escrita é 403
    const ger = await staff("gestor", "ger@prefeitura.gov.br");
    const adm = await staff("admin", "adm@prefeitura.gov.br");
    const made = await send("POST", "/staff/config/categories", adm, body);
    expect(made.statusCode).toBe(201);
    const slug = made.json().slug;
    expect((await send("GET", "/staff/config/audit", ger)).statusCode).toBe(200);
    expect((await send("GET", "/staff/geocode/status", ger)).statusCode).toBe(200);
    expect((await send("GET", "/meta", ger)).statusCode).toBe(200);
    const writes: [Parameters<typeof send>[0], string, unknown][] = [
      ["POST", "/staff/config/categories", body],
      ["PATCH", `/staff/config/categories/${slug}`, { active: false }],
      ["DELETE", `/staff/config/categories/${slug}`, undefined],
      ["PUT", "/staff/config/categories-order", { slugs: [slug] }],
      ["POST", "/staff/config/statuses", { name: "Em obra", color: "#f59e0b", icon: "wrench" }],
      ["PATCH", "/staff/config/statuses/em_analise", { active: false }],
      ["DELETE", "/staff/config/statuses/em_analise", undefined],
      ["PUT", "/staff/config/statuses-order", { slugs: ["em_analise"] }],
      ["PUT", "/staff/config/geocoder", { enabled: false }],
      ["POST", "/staff/geocode/backfill", undefined],
    ];
    for (const [m, u, b] of writes) expect((await send(m, u, ger, b)).statusCode, `${m} ${u}`).toBe(403);
    // nada mudou e o histórico não ganhou linhas pelas tentativas do gestor
    expect((await send("GET", "/meta", adm)).json().categories.find((c: { slug: string }) => c.slug === slug).active).toBe(true);
    await pool.query("delete from categories where not system");
  });
});

describe("categorias", () => {
  it("cria, valida, renomeia, desativa e audita", async () => {
    const g = await staff("admin", "g@prefeitura.gov.br");
    const created = await send("POST", "/staff/config/categories", g, { name: "Coleta de lixo", color: "#16a34a", icon: "trash" });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ slug: "coleta_de_lixo", system: false, active: true });

    // validações: cor, ícone fora da lista, campo desconhecido, nome repetido (sem diferenciar maiúsculas)
    expect((await send("POST", "/staff/config/categories", g, { name: "X1", color: "verde", icon: "trash" })).statusCode).toBe(400);
    expect((await send("POST", "/staff/config/categories", g, { name: "Outra", color: "#16a34a", icon: "<script>" })).statusCode).toBe(400);
    expect((await send("POST", "/staff/config/categories", g, { name: "Outra", color: "#16a34a", icon: "trash", system: true })).statusCode).toBe(400);
    expect((await send("POST", "/staff/config/categories", g, { name: "COLETA DE LIXO", color: "#16a34a", icon: "trash" })).statusCode).toBe(409);

    // a nova categoria já vale para o cidadão
    const cit = await citizen("c@example.com");
    expect((await multipartCreate("/occurrences", cit, occ({ category: "coleta_de_lixo" }))).statusCode).toBe(201);

    // renomear e desativar
    expect((await send("PATCH", "/staff/config/categories/coleta_de_lixo", g, { name: "Lixo e entulho", color: "#15803d" })).json()).toMatchObject({ name: "Lixo e entulho", color: "#15803d" });
    expect((await send("PATCH", "/staff/config/categories/coleta_de_lixo", g, { active: false })).json().active).toBe(false);
    // desativada: não aceita novas ocorrências
    expect((await multipartCreate("/occurrences", cit, occ({ category: "coleta_de_lixo" }))).statusCode).toBe(400);
    // categoria inexistente também
    expect((await multipartCreate("/occurrences", cit, occ({ category: "nao_existe" }))).statusCode).toBe(400);

    // não exclui com ocorrências nem a do sistema
    expect((await send("DELETE", "/staff/config/categories/coleta_de_lixo", g)).statusCode).toBe(409);
    expect((await send("DELETE", "/staff/config/categories/seguranca", g)).statusCode).toBe(409);
    expect((await send("DELETE", "/staff/config/categories/inexistente", g)).statusCode).toBe(404);

    const audit = (await send("GET", "/staff/config/audit", g)).json().items as { action: string; entityKey: string; changes: Record<string, unknown> }[];
    expect(audit.map((a) => a.action)).toEqual(["update", "update", "create"]);
    expect(audit[2]!.changes).toMatchObject({ name: { to: "Coleta de lixo" } });
    expect(audit[1]!.changes).toMatchObject({ name: { from: "Coleta de lixo", to: "Lixo e entulho" } });
  });

  it("exclui categoria sem uso e reordena exigindo a lista completa", async () => {
    const g = await staff("admin", "g@prefeitura.gov.br");
    await send("POST", "/staff/config/categories", g, { name: "Árvores", color: "#16a34a", icon: "tree" });
    const all = (await send("GET", "/meta")).json().categories.map((c: { slug: string }) => c.slug) as string[];
    expect(all.at(-1)).toBe("arvores");
    const reversed = [...all].reverse();
    expect((await send("PUT", "/staff/config/categories-order", g, { slugs: reversed.slice(1) })).statusCode).toBe(400);
    expect((await send("PUT", "/staff/config/categories-order", g, { slugs: [...reversed.slice(1), reversed[1]] })).statusCode).toBe(400);
    expect((await send("PUT", "/staff/config/categories-order", g, { slugs: reversed })).statusCode).toBe(204);
    expect((await send("GET", "/meta")).json().categories.map((c: { slug: string }) => c.slug)).toEqual(reversed);
    expect((await send("DELETE", "/staff/config/categories/arvores", g)).statusCode).toBe(204);
  });
});

describe("status", () => {
  it("status novo é 'em andamento': aparece no mapa, entra no fluxo e notifica com o nome certo", async () => {
    const g = await staff("admin", "g@prefeitura.gov.br");
    const cit = await citizen("c@example.com");
    const created = await send("POST", "/staff/config/statuses", g, { name: "Aguardando peça", color: "#a855f7" });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ slug: "aguardando_peca", kind: "active", isEntry: false, system: false });

    const o = (await multipartCreate("/occurrences", cit, occ())).json();
    // não verificado -> aguardando_peca não pode (só o primeiro estágio sai do não verificado)
    expect((await send("PATCH", `/staff/occurrences/${o.id}`, g, { status: "aguardando_peca" })).statusCode).toBe(409);
    expect((await send("PATCH", `/staff/occurrences/${o.id}`, g, { status: "em_analise" })).statusCode).toBe(200);
    expect((await send("PATCH", `/staff/occurrences/${o.id}`, g, { status: "aguardando_peca" })).statusCode).toBe(200);

    const mapRes = await send("GET", "/occurrences/map?bbox=-74,-34,-28,6");
    expect(mapRes.json().items.map((i: { id: string }) => i.id)).toContain(o.id);
    const notes = (await send("GET", "/me/notifications", cit)).json().items as { body: string; toStatus: string }[];
    expect(notes[0]).toMatchObject({ toStatus: "aguardando_peca" });
    expect(notes[0]!.body).toContain("Em análise → Aguardando peça");

    // resolve e reabre pelo status novo (reabrir só para um não-inicial)
    expect((await send("PATCH", `/staff/occurrences/${o.id}`, g, { status: "resolvido" })).statusCode).toBe(200);
    expect((await send("PATCH", `/staff/occurrences/${o.id}`, g, { status: "aguardando_peca" })).statusCode).toBe(200);
  });

  it("protege os status do sistema e só exclui status nunca usado", async () => {
    const g = await staff("admin", "g@prefeitura.gov.br");
    expect((await send("PATCH", "/staff/config/statuses/resolvido", g, { active: false })).statusCode).toBe(409);
    expect((await send("DELETE", "/staff/config/statuses/resolvido", g)).statusCode).toBe(409);
    // renomear o do sistema é permitido e não muda a regra (continua do tipo resolved)
    expect((await send("PATCH", "/staff/config/statuses/resolvido", g, { name: "Concluído" })).json()).toMatchObject({ name: "Concluído", kind: "resolved" });
    // kind não pode ser enviado
    expect((await send("PATCH", "/staff/config/statuses/resolvido", g, { kind: "active" })).statusCode).toBe(400);
    await send("PATCH", "/staff/config/statuses/resolvido", g, { name: "Resolvido" });

    await send("POST", "/staff/config/statuses", g, { name: "Vistoria agendada", color: "#0ea5e9" });
    const cit = await citizen("c@example.com");
    const o = (await multipartCreate("/staff/occurrences", g, occ({ status: "vistoria_agendada" }))).json();
    expect(o.status).toBe("vistoria_agendada");
    void cit;
    expect((await send("DELETE", "/staff/config/statuses/vistoria_agendada", g)).statusCode).toBe(409);
    await send("POST", "/staff/config/statuses", g, { name: "Nunca usado", color: "#0ea5e9" });
    expect((await send("DELETE", "/staff/config/statuses/nunca_usado", g)).statusCode).toBe(204);
  });

  it("cadastro manual não aceita status resolvido/recusado nem inativo", async () => {
    const g = await staff("admin", "g@prefeitura.gov.br");
    expect((await multipartCreate("/staff/occurrences", g, occ({ status: "recusado" }))).statusCode).toBe(400);
    expect((await multipartCreate("/staff/occurrences", g, occ({ status: "nao_existe" }))).statusCode).toBe(400);
    await send("POST", "/staff/config/statuses", g, { name: "Temporário", color: "#0ea5e9" });
    await send("PATCH", "/staff/config/statuses/temporario", g, { active: false });
    expect((await multipartCreate("/staff/occurrences", g, occ({ status: "temporario" }))).statusCode).toBe(400);
  });

  it("a regra dos 5 dias continua valendo pelo tipo do status (renomeado)", async () => {
    const g = await staff("admin", "g@prefeitura.gov.br");
    const o = (await multipartCreate("/staff/occurrences", g, occ())).json();
    await send("PATCH", `/staff/occurrences/${o.id}`, g, { status: "resolvido" });
    await pool.query("update occurrences set resolved_at = now() - interval '6 days' where id = $1", [o.id]);
    expect((await send("GET", "/occurrences/map?bbox=-74,-34,-28,6")).json().items).toHaveLength(0);
    expect((await send("GET", "/occurrences/map?bbox=-74,-34,-28,6&includeResolved=true")).json().items).toHaveLength(1);
  });
});

describe("auditoria da configuração é imutável", () => {
  it("o banco recusa UPDATE e DELETE", async () => {
    const g = await staff("admin", "g@prefeitura.gov.br");
    await send("POST", "/staff/config/categories", g, { name: "Teste imutável", color: "#16a34a", icon: "tree" });
    await expect(pool.query("update config_audit set action = 'x'")).rejects.toThrow();
    await expect(pool.query("delete from config_audit")).rejects.toThrow();
  });
});

describe("relatórios", () => {
  it("agrega por bairro, categoria, status e período; servidor acessa, cidadão não", async () => {
    const g = await staff("admin", "g@prefeitura.gov.br");
    const cit = await citizen("c@example.com");
    const a = (await multipartCreate("/staff/occurrences", g, occ({ neighborhood: "Centro" }))).json();
    await multipartCreate("/staff/occurrences", g, occ({ neighborhood: "Centro", category: "seguranca" }));
    await multipartCreate("/staff/occurrences", g, occ({ neighborhood: "Mooca" }));
    await multipartCreate("/staff/occurrences", g, occ()); // sem bairro (geocoder devolve "Centro" depois)
    await app.geocode.idle();
    await send("PATCH", `/staff/occurrences/${a.id}`, g, { status: "resolvido" });
    await pool.query("update occurrences set resolved_at = created_at + interval '30 hours' where id = $1", [a.id]);

    expect((await send("GET", "/staff/reports", cit)).statusCode).toBe(403);
    const r = (await send("GET", "/staff/reports", g)).json();
    expect(r.totals).toMatchObject({ total: 4, resolved: 1, open: 3, avgResolutionHours: 30, noNeighborhood: 0 });
    expect(r.byNeighborhood[0]).toMatchObject({ key: "Centro", total: 3, resolved: 1, avgHours: 30 });
    expect(r.byCategory.find((c: { key: string }) => c.key === "iluminacao")).toMatchObject({ total: 3, resolved: 1 });
    expect(r.resolutionBuckets).toEqual({ lt1d: 0, d1to3: 1, d3to7: 0, gt7d: 0 });
    expect(r.byPeriod.reduce((n: number, p: { total: number }) => n + p.total, 0)).toBe(4);

    const filtered = (await send("GET", "/staff/reports?category=seguranca&from=2000-01-01&to=2100-01-01", g)).json();
    expect(filtered.totals.total).toBe(1);
    expect((await send("GET", "/staff/reports?from=ontem", g)).statusCode).toBe(400);
    expect((await send("GET", "/staff/reports?category=a'; drop table users;--", g)).statusCode).toBe(400);
  });
});

describe("bairro automático", () => {
  it("preenche em segundo plano, audita como automático e não sobrescreve bairro informado", async () => {
    const g = await staff("admin", "g@prefeitura.gov.br");
    const created = (await multipartCreate("/staff/occurrences", g, occ())).json();
    expect(created.neighborhood).toBeNull(); // a resposta não espera o geocoder
    await app.geocode.idle();
    expect(geocoded).toEqual([[-23.55, -46.63]]);
    const { rows } = await pool.query("select neighborhood from occurrences where id = $1", [created.id]);
    expect(rows[0].neighborhood).toBe("Centro");
    const audit = await pool.query("select action, changes from occurrence_audit where occurrence_id = $1 order by id", [created.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(["create", "geocode_auto"]);
    expect(audit.rows[1].changes.neighborhood).toMatchObject({ from: null, to: "Centro", auto: true });

    await multipartCreate("/staff/occurrences", g, occ({ neighborhood: "Mooca" }));
    await app.geocode.idle();
    expect(geocoded).toHaveLength(1); // com bairro informado não consulta
  });

  it("falha do serviço deixa a ocorrência sem bairro; o backfill reprocessa", async () => {
    const g = await staff("admin", "g@prefeitura.gov.br");
    geocoderAnswer = null;
    await multipartCreate("/staff/occurrences", g, occ());
    await multipartCreate("/staff/occurrences", g, occ({ lat: "-23.56" }));
    await app.geocode.idle();
    expect((await pool.query("select count(*)::int as n from occurrences where neighborhood is null")).rows[0].n).toBe(2);

    geocoderAnswer = "Pinheiros";
    const res = await send("POST", "/staff/geocode/backfill", g);
    expect(res.json()).toMatchObject({ queued: 2 });
    await app.geocode.idle();
    expect((await pool.query("select count(*)::int as n from occurrences where neighborhood = 'Pinheiros'")).rows[0].n).toBe(2);
  });

  it("serviço desligado: backfill responde 409", async () => {
    const off = await buildApp({ rateLimit: false, geocoder: null });
    await off.ready();
    const g = await staff("admin", "g2@prefeitura.gov.br");
    const res = await off.inject({ method: "POST", url: "/staff/geocode/backfill", headers: { authorization: `Bearer ${g}` } });
    expect(res.statusCode).toBe(409);
    await off.close();
  });
});

describe("área de atuação", () => {
  const concordia = { name: "Concórdia", bbox: [-52.35, -27.48, -51.78, -27.0] };
  afterEach(async () => {
    await pool.query("delete from app_settings where key = 'service_area'");
    invalidateSettings();
  });

  it("só admin altera; vale na hora para /meta e para criar/mover ocorrências; mudança auditada", async () => {
    const admin = await staff("admin", "adm@prefeitura.gov.br");
    const gestor = await staff("gestor", "g@prefeitura.gov.br");
    const cid = await citizen("c@example.com");
    expect((await send("GET", "/meta")).json().serviceArea).toBeNull(); // sem padrão no .env dos testes

    expect((await send("PUT", "/staff/config/service-area", gestor, { area: concordia })).statusCode).toBe(403);
    expect((await send("PUT", "/staff/config/service-area", admin, { area: { name: "Brasil", bbox: [-74, -34, -34, 5] } })).statusCode).toBe(400);
    expect((await send("PUT", "/staff/config/service-area", admin, { area: { ...concordia, bbox: [-51, -27, -52, -26] } })).statusCode).toBe(400);
    expect((await send("PUT", "/staff/config/service-area", admin, { area: concordia })).json()).toEqual({ area: concordia });
    expect((await send("GET", "/meta")).json().serviceArea).toEqual(concordia);

    const fora = await multipartCreate("/occurrences", cid, occ()); // São Paulo
    expect(fora.statusCode).toBe(400);
    expect(fora.json().error).toContain("Concórdia");
    const dentro = await multipartCreate("/occurrences", cid, occ({ lat: "-27.2335", lng: "-52.0278" }));
    expect(dentro.statusCode).toBe(201);
    expect((await multipartCreate("/staff/occurrences", admin, occ())).statusCode).toBe(400);
    expect((await send("PATCH", `/staff/occurrences/${dentro.json().id}`, admin, { lat: -23.5, lng: -46.6 })).statusCode).toBe(400);

    // "sem limite" também é uma escolha gravada
    expect((await send("PUT", "/staff/config/service-area", admin, { area: null })).statusCode).toBe(200);
    expect((await multipartCreate("/occurrences", cid, occ())).statusCode).toBe(201);
    const audit = (await pool.query("select changes from config_audit where entity_key = 'service_area' order by id")).rows;
    expect(audit.map((a) => a.changes.area.to?.name ?? null)).toEqual(["Concórdia", null]);
  });

  it("busca de município é só do admin e valida o termo", async () => {
    const gestor = await staff("gestor", "g@prefeitura.gov.br");
    const admin = await staff("admin", "adm@prefeitura.gov.br");
    expect((await send("GET", "/staff/geocode/search?q=Concordia", gestor)).statusCode).toBe(403);
    expect((await send("GET", "/staff/geocode/search?q=a", admin)).statusCode).toBe(400);
  });
});
