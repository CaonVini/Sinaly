import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ??= "j".repeat(48);
process.env.CPF_HASH_PEPPER ??= "p".repeat(48);
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "sinaly-uploads-"));
if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL apontando para um banco de TESTE");

const { buildApp } = await import("../src/app.js");
const { db, pool } = await import("../src/db/client.js");
const { users } = await import("../src/db/schema.js");
const { encrypt } = await import("../src/security/crypto.js");
const { hashPassword } = await import("../src/security/password.js");
const { generateTotpSecret, totpAt, currentStep } = await import("../src/security/totp.js");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

const PASS = "senha-bem-longa-123";
const STAFF_PASS = "senha-do-funcionario-forte";
const SP = { lat: -23.55, lng: -46.63 };
const RJ = { lat: -22.9, lng: -43.17 };
const BBOX_SP = "-47,-24,-46,-23";
const BBOX_ALL = "-74,-34,-28,6";
const profile = (cpf: string) => ({
  firstName: "Maria", lastName: "da Silva", phone: "11912345678", cpf,
  address: { cep: "01001000", street: "Praça da Sé", number: "10", neighborhood: "Sé", city: "São Paulo", state: "SP" },
});

const send = (method: "GET" | "POST" | "PATCH" | "PUT", url: string, token?: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function jpeg(opts: { width?: number; height?: number; exif?: boolean } = {}) {
  let img = sharp({ create: { width: opts.width ?? 1200, height: opts.height ?? 800, channels: 3, background: "#cc3333" } }).jpeg();
  if (opts.exif) img = img.withExif({ IFD0: { Copyright: "dados-pessoais-no-exif" } });
  return img.toBuffer();
}

async function multipartPost(url: string, token: string, fields: Record<string, string>, file?: { data: Buffer; name?: string; type?: string; field?: string }, method: "POST" | "PUT" = "POST") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append(file.field ?? "photo", new Blob([new Uint8Array(file.data)], { type: file.type ?? "image/jpeg" }), file.name ?? "foto.jpg");
  const res = new Response(fd);
  return app.inject({ method, url, payload: Buffer.from(await res.arrayBuffer()), headers: { authorization: `Bearer ${token}`, "content-type": res.headers.get("content-type")! } });
}

const fields = (over: Record<string, string> = {}) => ({ category: "iluminacao", description: "Poste com a lâmpada apagada há uma semana", lat: String(SP.lat), lng: String(SP.lng), ...over });

async function citizen(email: string, cpf: string | null) {
  const res = await send("POST", "/auth/register", undefined, { email, password: PASS });
  const { accessToken } = res.json();
  if (cpf) expect((await send("POST", "/me/onboarding", accessToken, profile(cpf))).statusCode).toBe(201);
  const [u] = await pool.query("select id from users where email = $1", [email]).then((r) => r.rows);
  return { token: accessToken as string, id: u.id as string };
}

async function staff(role: "servidor" | "gestor" = "servidor", email = "func@prefeitura.gov.br") {
  const secret = generateTotpSecret();
  await db.insert(users).values({ email, name: "Func Prefeitura", role, passwordHash: await hashPassword(STAFF_PASS), totpSecretEnc: encrypt(secret) });
  const res = await send("POST", "/auth/staff/login", undefined, { email, password: STAFF_PASS, totp: totpAt(secret, currentStep()) });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken as string;
}

async function create(token: string, over: Record<string, string> = {}, withPhoto = true) {
  const res = await multipartPost("/occurrences", token, fields(over), withPhoto ? { data: await jpeg() } : undefined);
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; status: string; photoUrl: string | null; lat: number; lng: number };
}

const patch = (token: string, id: string, body: unknown) => send("PATCH", `/staff/occurrences/${id}`, token, body);
const map = (token?: string, qs = `bbox=${BBOX_ALL}`) => send("GET", `/occurrences/map?${qs}`, token);
const ids = (res: { json: () => { items: { id: string }[] } }) => res.json().items.map((i) => i.id);

beforeAll(async () => {
  app = await buildApp({ rateLimit: false });
  app.get("/_boom", async () => pool.query("select * from tabela_que_nao_existe"));
  await app.ready();
});
beforeEach(async () => {
  await pool.query("truncate users, auth_events cascade");
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("criar ocorrência", () => {
  it("exige login de cidadão com onboarding concluído", async () => {
    const noProfile = await citizen("a@example.com", null);
    expect((await multipartPost("/occurrences", noProfile.token, fields(), { data: await jpeg() })).statusCode).toBe(403);
    expect((await send("POST", "/occurrences")).statusCode).toBe(401);
    const st = await staff();
    expect((await multipartPost("/occurrences", st, fields(), { data: await jpeg() })).statusCode).toBe(403);
  });

  it("cria com status 'nao_verificado', local exato, foto processada e trilha de auditoria", async () => {
    const c = await citizen("a@example.com", "529.982.247-25");
    const o = await create(c.token);
    expect(o.status).toBe("nao_verificado");
    expect(o.lat).toBeCloseTo(SP.lat, 6);
    expect(o.lng).toBeCloseTo(SP.lng, 6);
    const { rows } = await pool.query("select ST_SRID(location) as srid, photo_key from occurrences");
    expect(rows[0].srid).toBe(4326);
    expect(existsSync(path.join(process.env.UPLOAD_DIR!, rows[0].photo_key))).toBe(true);
    const audit = await pool.query("select action, actor_id, actor_role, created_at from occurrence_audit");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: "create", actor_id: c.id, actor_role: "cidadao" });
    expect(audit.rows[0].created_at).toBeInstanceOf(Date);
  });

  it("foto é opcional", async () => {
    const c = await citizen("a@example.com", "529.982.247-25");
    expect((await create(c.token, {}, false)).photoUrl).toBeNull();
  });

  it("valida os campos", async () => {
    const c = await citizen("a@example.com", "529.982.247-25");
    const bad = async (over: Record<string, string>) => (await multipartPost("/occurrences", c.token, fields(over))).statusCode;
    expect(await bad({ lat: "91" })).toBe(400);
    expect(await bad({ lng: "abc" })).toBe(400);
    expect(await bad({ lat: "" })).toBe(400);
    expect(await bad({ description: "curta" })).toBe(400);
    expect(await bad({ category: "inexistente" })).toBe(400);
    expect((await send("POST", "/occurrences", c.token, fields())).statusCode).toBe(415); // JSON em vez de multipart
  });

  it("não deixa o cliente escolher status, autor ou dono", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const b = await citizen("b@example.com", "390.533.447-05");
    const res = await multipartPost("/occurrences", a.token, { ...fields(), status: "resolvido", authorId: b.id });
    expect(res.json().status).toBe("nao_verificado");
    const { rows } = await pool.query("select author_id from occurrences");
    expect(rows[0].author_id).toBe(a.id);
  });

  it("reprocessa a foto: remove EXIF, limita o tamanho e converte PNG", async () => {
    const c = await citizen("a@example.com", "529.982.247-25");
    const withExif = await jpeg({ width: 3000, height: 2000, exif: true });
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    await multipartPost("/occurrences", c.token, fields(), { data: withExif });
    const png = await sharp({ create: { width: 500, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
    expect((await multipartPost("/occurrences", c.token, fields(), { data: png, name: "x.png", type: "image/png" })).statusCode).toBe(201);
    const { rows } = await pool.query("select photo_key from occurrences order by created_at");
    const stored = await sharp(path.join(process.env.UPLOAD_DIR!, rows[0].photo_key)).metadata();
    expect(stored.exif).toBeUndefined();
    expect(stored.width).toBe(1600);
    expect(stored.format).toBe("jpeg");
    expect((await sharp(path.join(process.env.UPLOAD_DIR!, rows[0].photo_key.replace(".jpg", "-t.jpg"))).metadata()).width).toBe(400);
    expect((await sharp(path.join(process.env.UPLOAD_DIR!, rows[1].photo_key)).metadata()).format).toBe("jpeg");
  });

  it("rejeita arquivos que não são imagem, mesmo com nome e tipo de imagem", async () => {
    const c = await citizen("a@example.com", "529.982.247-25");
    const post = async (data: Buffer, name = "foto.jpg", type = "image/jpeg") => (await multipartPost("/occurrences", c.token, fields(), { data, name, type })).statusCode;
    expect(await post(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBe(400);
    expect(await post(Buffer.from("#!/bin/sh\nrm -rf /\n"))).toBe(400);
    expect(await post(Buffer.from("%PDF-1.4 fake"))).toBe(400);
    expect(await post((await jpeg()).subarray(0, 200))).toBe(400); // truncada
    expect(await post(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).gif().toBuffer(), "a.gif", "image/gif")).toBe(400);
    expect((await pool.query("select count(*)::int as n from occurrences")).rows[0].n).toBe(0);
  });

  it("rejeita arquivo acima de 5 MB (413) e campo de arquivo inesperado", async () => {
    const c = await citizen("a@example.com", "529.982.247-25");
    expect((await multipartPost("/occurrences", c.token, fields(), { data: Buffer.alloc(5 * 1024 * 1024 + 10, 1) })).statusCode).toBe(413);
    expect((await multipartPost("/occurrences", c.token, fields(), { data: await jpeg(), field: "arquivo" })).statusCode).toBe(400);
  });

  it("limita 20 ocorrências por cidadão em 24 h", async () => {
    const c = await citizen("a@example.com", "529.982.247-25");
    await pool.query(
      `insert into occurrences (author_id, category, description, location) select $1, 'iluminacao', 'teste ' || g, ST_SetSRID(ST_MakePoint(-46.6, -23.5), 4326) from generate_series(1, 20) g`,
      [c.id],
    );
    expect((await multipartPost("/occurrences", c.token, fields())).statusCode).toBe(429);
  });
});

describe("visibilidade", () => {
  it("ocorrência não verificada só aparece para o dono e para a prefeitura", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const b = await citizen("b@example.com", "390.533.447-05");
    const st = await staff();
    const o = await create(a.token);

    for (const viewer of [a.token, st]) {
      expect(ids(await map(viewer))).toEqual([]); // mapa público nunca mostra não verificadas
      expect((await send("GET", `/occurrences/${o.id}`, viewer)).statusCode).toBe(200);
      expect((await send("GET", `/occurrences/${o.id}/photo`, viewer)).statusCode).toBe(200);
    }
    // outro cidadão e anônimo: 404 (nem revela que existe)
    for (const viewer of [b.token, undefined]) {
      expect((await send("GET", `/occurrences/${o.id}`, viewer)).statusCode).toBe(404);
      expect((await send("GET", `/occurrences/${o.id}/photo`, viewer)).statusCode).toBe(404);
      expect(ids(await map(viewer))).toEqual([]);
    }
    expect(ids(await send("GET", "/me/occurrences", a.token))).toEqual([o.id]);
    expect(ids(await send("GET", "/me/occurrences", b.token))).toEqual([]);
    expect(ids(await send("GET", "/staff/occurrences", st))).toEqual([o.id]);
    expect((await send("GET", "/staff/occurrences", a.token)).statusCode).toBe(403);
  });

  it("prefeitura cadastra ocorrência manualmente (ligação), sem foto, com contato protegido", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const f = { category: "seguranca", description: "Moradora ligou relatando poste caído na calçada", lat: String(SP.lat), lng: String(SP.lng), reporterName: "Dona Rita", reporterPhone: "(11) 91234-5678" };

    // cidadão não pode; campos inválidos não passam
    expect((await multipartPost("/staff/occurrences", a.token, f)).statusCode).toBe(403);
    expect((await multipartPost("/staff/occurrences", st, { ...f, reporterPhone: "123" })).statusCode).toBe(400);
    expect((await multipartPost("/staff/occurrences", st, { ...f, status: "resolvido" })).statusCode).toBe(400);
    expect((await multipartPost("/staff/occurrences", st, { ...f, description: "curta" })).statusCode).toBe(400);

    const res = await multipartPost("/staff/occurrences", st, f);
    expect(res.statusCode).toBe(201);
    const o = res.json();
    expect(o.status).toBe("em_analise"); // padrão da prefeitura: já visível no mapa
    expect(o.source).toBe("prefeitura");
    expect(o.photoUrl).toBeNull();
    expect(o.contact).toEqual({ name: "Dona Rita", phone: "11912345678" });

    // contato cifrado em repouso
    const raw = await pool.query("select reporter_contact_enc as c from occurrences where id = $1", [o.id]).then((r) => r.rows[0].c as string);
    expect(raw).not.toContain("Rita");
    expect(raw).not.toContain("91234");

    // público vê a ocorrência, mas nunca origem nem contato
    const pub = (await send("GET", `/occurrences/${o.id}`)).json();
    expect(pub.id).toBe(o.id);
    expect(pub).not.toHaveProperty("contact");
    expect(pub).not.toHaveProperty("source");
    expect(ids(await map())).toContain(o.id);
    // funcionário vê origem e contato no detalhe e na lista
    const det = (await send("GET", `/occurrences/${o.id}`, st)).json();
    expect(det.contact.phone).toBe("11912345678");
    const list = (await send("GET", "/staff/occurrences", st)).json().items[0];
    expect(list.source).toBe("prefeitura");

    // auditoria: criação pelo funcionário, sem telefone em texto aberto
    const audit = (await send("GET", `/staff/occurrences/${o.id}/audit`, st)).json().items;
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("create");
    expect(audit[0].actorRole).toBe("servidor");
    expect(JSON.stringify(audit)).not.toContain("91234");

    // com foto também funciona e com status inicial escolhido
    const withPhoto = await multipartPost("/staff/occurrences", st, { ...f, status: "nao_verificado", reporterPhone: "" , reporterName: "" }, { data: await jpeg() });
    expect(withPhoto.statusCode).toBe(201);
    expect(withPhoto.json().status).toBe("nao_verificado");
    expect(withPhoto.json().contact).toBeNull();
    expect(withPhoto.json().photoUrl).toContain("/photo");
  });

  it("lista da prefeitura filtra por período de criação", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const o = await create(a.token);
    const today = new Date().toISOString().slice(0, 10);
    const ontem = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
    expect(ids(await send("GET", `/staff/occurrences?from=${ontem}&to=${today}`, st))).toEqual([o.id]);
    expect(ids(await send("GET", `/staff/occurrences?to=${ontem}`, st))).toEqual([]);
    expect((await send("GET", "/staff/occurrences?from=ontem", st)).statusCode).toBe(400);
  });

  it("estatísticas do painel: só funcionário, com contagens corretas", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const o1 = await create(a.token);
    await create(a.token, { category: "saneamento" });
    await patch(st, o1.id, { status: "em_analise" });
    expect((await send("GET", "/staff/stats", a.token)).statusCode).toBe(403);
    expect((await send("GET", "/staff/stats")).statusCode).toBe(401);
    const res = await send("GET", "/staff/stats", st);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.byStatus).toEqual({ nao_verificado: 1, em_analise: 1 });
    expect(body.byCategory).toEqual({ iluminacao: 1, saneamento: 1 });
    expect(body.avgResolutionHours).toBeNull();
    expect(body.perDay).toHaveLength(14);
    expect(body.perDay.at(-1).total).toBe(2);
  });

  it("depois que a prefeitura aprova, todos veem no mapa, no detalhe e na foto", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const b = await citizen("b@example.com", "390.533.447-05");
    const st = await staff();
    const o = await create(a.token);
    expect((await patch(st, o.id, { status: "em_analise" })).statusCode).toBe(200);

    for (const viewer of [b.token, undefined]) {
      expect(ids(await map(viewer))).toEqual([o.id]);
      const detail = await send("GET", `/occurrences/${o.id}`, viewer);
      expect(detail.statusCode).toBe(200);
      expect(detail.json().history).toBeUndefined(); // histórico é só do dono e da prefeitura
      expect(detail.json().authorId).toBeUndefined();
      const photo = await send("GET", `/occurrences/${o.id}/photo`, viewer);
      expect(photo.statusCode).toBe(200);
      expect(photo.headers["content-type"]).toBe("image/jpeg");
      expect(photo.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    }
    expect((await send("GET", `/occurrences/${o.id}`, a.token)).json().history).toHaveLength(2);
  });

  it("nenhuma resposta expõe chave de arquivo, id do autor ou campos internos a quem não é da prefeitura", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const o = await create(a.token);
    await patch(st, o.id, { status: "em_analise" });
    const bodies = [
      (await map()).body,
      (await send("GET", `/occurrences/${o.id}`)).body,
      (await send("GET", `/occurrences/${o.id}`, a.token)).body,
      (await send("GET", "/me/occurrences", a.token)).body,
    ];
    for (const body of bodies) {
      expect(body).not.toMatch(/photoKey|photo_key|authorId|cursorTs|occ\/[0-9a-f-]{36}/);
    }
  });

  it("recusada volta a ser privada (dono e prefeitura apenas)", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const b = await citizen("b@example.com", "390.533.447-05");
    const st = await staff();
    const o = await create(a.token);
    await patch(st, o.id, { status: "em_analise" });
    await patch(st, o.id, { status: "recusado", note: "Duplicada" });
    expect((await send("GET", `/occurrences/${o.id}`, b.token)).statusCode).toBe(404);
    expect(ids(await map())).toEqual([]);
    expect((await send("GET", `/occurrences/${o.id}`, a.token)).statusCode).toBe(200);
  });

  it("mapa filtra por área e categoria e informa quando trunca", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const sp = await create(a.token);
    const rj = await create(a.token, { lat: String(RJ.lat), lng: String(RJ.lng), category: "saneamento" });
    for (const o of [sp, rj]) await patch(st, o.id, { status: "em_analise" });
    expect(ids(await map(undefined, `bbox=${BBOX_SP}`))).toEqual([sp.id]);
    expect(ids(await map(undefined, `bbox=${BBOX_ALL}&category=saneamento`))).toEqual([rj.id]);
    const limited = await map(undefined, `bbox=${BBOX_ALL}&limit=1`);
    expect(limited.json().items).toHaveLength(1);
    expect(limited.json().truncated).toBe(true);
    expect((await map(undefined, "bbox=1,2")).statusCode).toBe(400);
    expect((await send("GET", "/occurrences/map")).statusCode).toBe(400); // bbox é obrigatório
  });
});

describe("somente a prefeitura altera", () => {
  it("cidadão não altera nada, nem o que é dele; anônimo é barrado", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const o = await create(a.token);
    expect((await patch(a.token, o.id, { status: "resolvido" })).statusCode).toBe(403);
    expect((await patch(a.token, o.id, { description: "Descrição alterada pelo cidadão" })).statusCode).toBe(403);
    expect((await patch("", o.id, { status: "em_analise" })).statusCode).toBe(401);
    expect((await multipartPost(`/staff/occurrences/${o.id}/photo`, a.token, {}, { data: await jpeg() }, "PUT")).statusCode).toBe(403);
    expect((await send("GET", `/staff/occurrences/${o.id}/audit`, a.token)).statusCode).toBe(403);
    const { rows } = await pool.query("select status, description from occurrences");
    expect(rows[0]).toMatchObject({ status: "nao_verificado", description: "Poste com a lâmpada apagada há uma semana" });
  });

  it("prefeitura edita campos, e a edição vai para a auditoria com autor, data e valores", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff("gestor");
    const o = await create(a.token);
    const res = await patch(st, o.id, { category: "seguranca", description: "Poste sem luz, rua escura e perigosa", lat: RJ.lat, lng: RJ.lng });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ changed: true, category: "seguranca", status: "nao_verificado" });
    const audit = (await send("GET", `/staff/occurrences/${o.id}/audit`, st)).json().items;
    expect(audit.map((x: { action: string }) => x.action)).toEqual(["create", "update"]);
    expect(audit[1]).toMatchObject({ actorName: "Func Prefeitura", actorRole: "gestor" });
    expect(audit[1].changes.category).toEqual({ from: "iluminacao", to: "seguranca" });
    expect(audit[1].changes.location.to).toEqual({ lat: RJ.lat, lng: RJ.lng });
    expect(Date.parse(audit[1].at)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("edição sem mudança real não gera auditoria nem notificação", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const o = await create(a.token);
    const res = await patch(st, o.id, { category: "iluminacao" });
    expect(res.json().changed).toBe(false);
    expect((await pool.query("select count(*)::int n from occurrence_audit")).rows[0].n).toBe(1);
  });

  it("rejeita campos desconhecidos, corpo vazio, ids inválidos e ocorrência inexistente", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const o = await create(a.token);
    expect((await patch(st, o.id, { authorId: a.id, status: "em_analise" })).statusCode).toBe(400);
    expect((await patch(st, o.id, { status: "inventado" })).statusCode).toBe(400);
    expect((await patch(st, o.id, {})).statusCode).toBe(400);
    expect((await patch(st, o.id, { lat: 1 })).statusCode).toBe(400);
    expect((await patch(st, o.id, { description: "Poste sem luz e rua escura", note: "solta" })).statusCode).toBe(400);
    expect((await patch(st, "nao-e-uuid", { status: "em_analise" })).statusCode).toBe(404);
    expect((await patch(st, "00000000-0000-4000-8000-000000000000", { status: "em_analise" })).statusCode).toBe(404);
  });

  it("só permite as transições previstas e exige motivo ao recusar", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const o = await create(a.token);
    expect((await patch(st, o.id, { status: "resolvido" })).statusCode).toBe(409);
    expect((await patch(st, o.id, { status: "em_atendimento" })).statusCode).toBe(409);
    expect((await patch(st, o.id, { status: "recusado" })).statusCode).toBe(400);
    expect((await patch(st, o.id, { status: "recusado", note: "Fora do município" })).statusCode).toBe(200);
    expect((await patch(st, o.id, { status: "em_analise" })).statusCode).toBe(409); // precisa reconsiderar antes
    expect((await patch(st, o.id, { status: "nao_verificado" })).statusCode).toBe(200);
  });

  it("prefeitura troca a foto; a antiga é apagada e a troca é auditada", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const o = await create(a.token);
    const before = (await pool.query("select photo_key from occurrences")).rows[0].photo_key as string;
    const res = await multipartPost(`/staff/occurrences/${o.id}/photo`, st, {}, { data: await jpeg({ width: 900, height: 900 }) }, "PUT");
    expect(res.statusCode).toBe(200);
    const after = (await pool.query("select photo_key from occurrences")).rows[0].photo_key as string;
    expect(after).not.toBe(before);
    expect(existsSync(path.join(process.env.UPLOAD_DIR!, before))).toBe(false);
    expect(existsSync(path.join(process.env.UPLOAD_DIR!, before.replace(".jpg", "-t.jpg")))).toBe(false);
    expect(existsSync(path.join(process.env.UPLOAD_DIR!, after))).toBe(true);
    const audit = (await send("GET", `/staff/occurrences/${o.id}/audit`, st)).json().items;
    expect(audit.at(-1)).toMatchObject({ action: "photo_replace" });
    expect((await multipartPost(`/staff/occurrences/${o.id}/photo`, st, {}, undefined, "PUT")).statusCode).toBe(400);
  });
});

describe("auditoria", () => {
  it("é imutável no banco: UPDATE e DELETE são bloqueados", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    await create(a.token);
    await expect(pool.query("update occurrence_audit set action = 'x'")).rejects.toThrow(/somente inserção/);
    await expect(pool.query("delete from occurrence_audit")).rejects.toThrow(/somente inserção/);
    // e não dá para apagar o usuário que tem trilha
    await expect(pool.query("delete from users where id = $1", [a.id])).rejects.toThrow();
  });

  it("toda mudança de status registra autor, hora, valores e a mensagem", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const o = await create(a.token);
    await patch(st, o.id, { status: "em_analise", note: "Equipe designada" });
    const rows = (await send("GET", `/staff/occurrences/${o.id}/audit`, st)).json().items;
    expect(rows[1]).toMatchObject({ action: "status_change", actorRole: "servidor" });
    expect(rows[1].changes).toEqual({ status: { from: "nao_verificado", to: "em_analise" }, note: { from: null, to: "Equipe designada" } });
  });
});

describe("notificações", () => {
  it("o dono é avisado a cada mudança de status e só ele", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const b = await citizen("b@example.com", "390.533.447-05");
    const st = await staff();
    const o = await create(a.token);
    expect((await send("GET", "/me/notifications", a.token)).json().unreadCount).toBe(0);

    await patch(st, o.id, { status: "em_analise" });
    await patch(st, o.id, { status: "em_atendimento", note: "Equipe a caminho" });
    await patch(st, o.id, { description: "Poste sem luz, descrição ajustada pela prefeitura" }); // não é status: sem notificação

    const mine = (await send("GET", "/me/notifications", a.token)).json();
    expect(mine.unreadCount).toBe(2);
    expect(mine.items).toHaveLength(2);
    expect(mine.items[0]).toMatchObject({ type: "status_changed", fromStatus: "em_analise", toStatus: "em_atendimento", occurrenceId: o.id, readAt: null });
    expect(mine.items[0].body).toContain("Equipe a caminho");
    expect((await send("GET", "/me/notifications", b.token)).json().items).toEqual([]);
  });

  it("marcar como lida: individual, todas, e nunca a de outra pessoa", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const b = await citizen("b@example.com", "390.533.447-05");
    const st = await staff();
    const o = await create(a.token);
    await patch(st, o.id, { status: "em_analise" });
    await patch(st, o.id, { status: "em_atendimento" });
    const [first, second] = (await send("GET", "/me/notifications", a.token)).json().items;

    expect((await send("POST", `/me/notifications/${first.id}/read`, b.token)).statusCode).toBe(404);
    expect((await send("GET", "/me/notifications?unread=true", a.token)).json().items).toHaveLength(2);
    expect((await send("POST", `/me/notifications/${first.id}/read`, a.token)).statusCode).toBe(204);
    expect((await send("GET", "/me/notifications?unread=true", a.token)).json().items.map((n: { id: string }) => n.id)).toEqual([second.id]);
    expect((await send("POST", "/me/notifications/read-all", a.token)).json().updated).toBe(1);
    expect((await send("GET", "/me/notifications", a.token)).json().unreadCount).toBe(0);
    expect((await send("GET", "/me/notifications")).statusCode).toBe(401);
  });

  it("pagina por cursor sem repetir nem perder itens", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    await pool.query(
      `insert into notifications (user_id, type, title, body) select $1, 'status_changed', 't', 'b' || g from generate_series(1, 5) g`,
      [a.id],
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const res = (await send("GET", `/me/notifications?limit=2${cursor ? `&cursor=${cursor}` : ""}`, a.token)).json();
      seen.push(...res.items.map((n: { id: string }) => n.id));
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect((await send("GET", "/me/notifications?cursor=lixo", a.token)).statusCode).toBe(400);
  });
});

describe("resolvida some do mapa após 5 dias e volta com o filtro", () => {
  it("regra dos 5 dias, filtro de resolvidas e reabertura", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const o = await create(a.token);
    await patch(st, o.id, { status: "em_analise" });
    await patch(st, o.id, { status: "resolvido", note: "Lâmpada trocada" });

    expect(ids(await map())).toEqual([o.id]); // recém-resolvida: ainda aparece
    expect((await pool.query("select resolved_at from occurrences")).rows[0].resolved_at).toBeInstanceOf(Date);

    await pool.query("update occurrences set resolved_at = now() - interval '4 days 23 hours'");
    expect(ids(await map())).toEqual([o.id]);

    await pool.query("update occurrences set resolved_at = now() - interval '5 days 1 minute'");
    expect(ids(await map())).toEqual([]); // sumiu do mapa
    expect(ids(await map(undefined, `bbox=${BBOX_ALL}&includeResolved=true`))).toEqual([o.id]); // filtro "resolvidos" traz de volta
    expect((await send("GET", `/occurrences/${o.id}`)).statusCode).toBe(200); // o detalhe segue acessível
    expect(ids(await send("GET", "/me/occurrences", a.token))).toEqual([o.id]); // e o dono sempre vê

    // reabrir: volta ao mapa normal e zera a data de resolução
    expect((await patch(st, o.id, { status: "em_atendimento" })).statusCode).toBe(200);
    expect(ids(await map())).toEqual([o.id]);
    expect((await pool.query("select resolved_at from occurrences")).rows[0].resolved_at).toBeNull();
  });

  it("resolvida de novo reinicia a contagem dos 5 dias", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const o = await create(a.token);
    for (const s of ["em_analise", "resolvido", "em_atendimento", "resolvido"]) await patch(st, o.id, { status: s });
    expect(ids(await map())).toEqual([o.id]);
    const { rows } = await pool.query("select extract(epoch from now() - resolved_at) as age from occurrences");
    expect(Number(rows[0].age)).toBeLessThan(60);
  });
});

describe("robustez", () => {
  it("erro interno não vaza SQL, tabela nem parâmetros", async () => {
    const res = await send("GET", "/_boom");
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Erro interno" });
    expect(res.body).not.toContain("tabela_que_nao_existe");
  });

  it("corridas: duas mudanças simultâneas de status não corrompem o histórico", async () => {
    const a = await citizen("a@example.com", "529.982.247-25");
    const st = await staff();
    const o = await create(a.token);
    const results = await Promise.all([patch(st, o.id, { status: "em_analise" }), patch(st, o.id, { status: "em_analise" }), patch(st, o.id, { status: "recusado", note: "x" })]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 200).length).toBeGreaterThanOrEqual(1);
    const hist = (await pool.query("select count(*)::int n from status_history where occurrence_id = $1", [o.id])).rows[0].n;
    const audits = (await pool.query("select count(*)::int n from occurrence_audit where occurrence_id = $1 and action = 'status_change'", [o.id])).rows[0].n;
    expect(hist - 1).toBe(audits); // cada mudança de status tem 1 histórico + 1 auditoria (o +1 é a criação)
  });
});
