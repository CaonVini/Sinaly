import { NextResponse } from "next/server";
import { apiFetch, clearSession, deny, sameOrigin } from "@/lib/server";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return deny(403, "Origem não permitida");
  await apiFetch("/auth/logout", { method: "POST" }).catch(() => null); // revoga a sessão na API
  await clearSession();
  return NextResponse.json({ ok: true });
}
