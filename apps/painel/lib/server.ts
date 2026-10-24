import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Camada servidor do painel (BFF). O navegador nunca recebe os tokens da API:
 * eles ficam em cookies httpOnly e só este código os lê e os repassa.
 */
const API_URL = (process.env.API_URL ?? "http://localhost:3333").replace(/\/$/, "");
const ACCESS = "sn_at";
const REFRESH = "sn_rt";
const REFRESH_MAX_AGE = 8 * 3600; // igual ao TTL da sessão de funcionário na API
const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : (process.env.PAINEL_URL ?? "").startsWith("https");

export type Tokens = { accessToken: string; refreshToken: string; expiresIn: string };

const base = { httpOnly: true, sameSite: "strict" as const, secure };

export async function setSession(t: Tokens) {
  const jar = await cookies();
  jar.set(ACCESS, t.accessToken, { ...base, path: "/", maxAge: 14 * 60 });
  // O refresh só trafega nas rotas /api do próprio painel.
  jar.set(REFRESH, t.refreshToken, { ...base, path: "/api", maxAge: REFRESH_MAX_AGE });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete({ name: ACCESS, path: "/" });
  jar.delete({ name: REFRESH, path: "/api" });
}

/** Mutações só aceitas se o Origin for o próprio painel (defesa extra além do SameSite=Strict). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const deny = (status: number, error: string) => NextResponse.json({ error }, { status });

async function refresh(): Promise<Tokens | null> {
  const jar = await cookies();
  const rt = jar.get(REFRESH)?.value;
  if (!rt) return null;
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: rt }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const t = (await res.json()) as Tokens;
  await setSession(t);
  return t;
}

/** Chama a API como o funcionário logado; renova o token uma vez se expirou. */
export async function apiFetch(path: string, init: { method?: string; body?: BodyInit | null; headers?: Record<string, string> } = {}) {
  const jar = await cookies();
  let access = jar.get(ACCESS)?.value;
  const call = (token?: string) =>
    fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      body: init.body ?? undefined,
      headers: { ...init.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      cache: "no-store",
      redirect: "manual",
    });
  let res = await call(access);
  if (res.status === 401) {
    const t = await refresh();
    if (!t) {
      await clearSession();
      return res;
    }
    access = t.accessToken;
    res = await call(access);
  }
  return res;
}

export { API_URL };
