import { NextResponse } from "next/server";
import { apiFetch, clearSession, deny, sameOrigin } from "@/lib/server";

/**
 * Proxy do painel para a API. Só repassa rotas conhecidas (lista branca); o resto é 404.
 * A autorização de verdade (papel de funcionário) continua sendo da API.
 */
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const ROUTES: { method: string; re: RegExp }[] = [
  { method: "GET", re: /^me$/ },
  { method: "GET", re: /^staff\/stats$/ },
  { method: "GET", re: /^staff\/occurrences$/ },
  { method: "GET", re: new RegExp(`^staff/occurrences/${UUID}/audit$`) },
  { method: "POST", re: /^staff\/occurrences$/ },
  { method: "PATCH", re: new RegExp(`^staff/occurrences/${UUID}$`) },
  { method: "GET", re: new RegExp(`^occurrences/${UUID}$`) },
  { method: "GET", re: new RegExp(`^occurrences/${UUID}/photo$`) },
];

const MAX_UPLOAD = 6 * 1024 * 1024; // foto de até 5 MB + campos do formulário

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (!ROUTES.some((r) => r.method === req.method && r.re.test(joined))) return deny(404, "Não encontrado");
  if (req.method !== "GET" && !sameOrigin(req)) return deny(403, "Origem não permitida");

  const search = new URL(req.url).search;
  let body: BodyInit | undefined;
  let fwdHeaders: Record<string, string> | undefined;
  if (req.method === "PATCH") {
    body = await req.text();
    fwdHeaders = { "content-type": "application/json" };
  } else if (req.method === "POST") {
    // Cadastro com foto (multipart). Limita antes de ler para não bufferizar corpo gigante; a API valida o resto.
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (!declared || declared > MAX_UPLOAD) return deny(413, "Arquivo grande demais (máximo 5 MB)");
    const type = req.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data")) return deny(415, "Envie como multipart/form-data");
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_UPLOAD) return deny(413, "Arquivo grande demais (máximo 5 MB)");
    fwdHeaders = { "content-type": type };
  }
  const res = await apiFetch(`/${joined}${search}`, { method: req.method, body, headers: fwdHeaders });
  if (res.status === 401) await clearSession();

  const headers = new Headers();
  for (const h of ["content-type", "content-length", "cache-control"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("cache-control", "private, no-store"); // nunca cachear resposta autenticada em proxy/CDN
  return new NextResponse(res.body, { status: res.status, headers });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
