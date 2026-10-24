import { NextResponse } from "next/server";
import { z } from "zod";
import { API_URL, deny, sameOrigin, setSession, type Tokens } from "@/lib/server";

const body = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256), totp: z.string().regex(/^\d{6}$/) }).strict();

export async function POST(req: Request) {
  if (!sameOrigin(req)) return deny(403, "Origem não permitida");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return deny(401, "Credenciais inválidas");

  const res = await fetch(`${API_URL}/auth/staff/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "" },
    body: JSON.stringify(parsed.data),
    cache: "no-store",
  });
  if (res.status === 429) return deny(429, "Muitas tentativas. Aguarde alguns minutos.");
  if (!res.ok) return deny(401, "Credenciais inválidas"); // mensagem única: não revela qual campo falhou
  const data = (await res.json()) as Tokens & { role: string };
  await setSession(data);
  return NextResponse.json({ role: data.role });
}
