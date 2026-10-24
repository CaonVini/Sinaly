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
  { method: "PATCH", re: new RegExp(`^staff/occurrences/${UUID}$`) },
  { method: "GET", re: new RegExp(`^occurrences/${UUID}$`) },
  { method: "GET", re: new RegExp(`^occurrences/${UUID}/photo$`) },
];

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (!ROUTES.some((r) => r.method === req.method && r.re.test(joined))) return deny(404, "Não encontrado");
  if (req.method !== "GET" && !sameOrigin(req)) return deny(403, "Origem não permitida");

  const search = new URL(req.url).search;
  const hasBody = req.method === "PATCH";
  const res = await apiFetch(`/${joined}${search}`, {
    method: req.method,
    body: hasBody ? await req.text() : undefined,
    headers: hasBody ? { "content-type": "application/json" } : undefined,
  });
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
export const PATCH = handle;
