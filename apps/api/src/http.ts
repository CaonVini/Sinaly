import type { ZodTypeAny, z } from "zod";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Valida com zod e lança 400 padronizado (nunca devolve o erro cru do zod). */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, "Dados inválidos", r.error.flatten().fieldErrors);
  return r.data;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Limite de requisições por rota; desligado nos testes via buildApp({ rateLimit: false }). */
export const limitConfig = (enabled: boolean, max: number, timeWindow: string) =>
  enabled ? { config: { rateLimit: { max, timeWindow } } } : {};

// Paginação por cursor (keyset): estável e rápida mesmo com muitas linhas, ao contrário de OFFSET.
// O timestamp viaja como texto com microssegundos para não perder precisão entre Postgres e JS.
export const encodeCursor = (ts: string, id: string) => Buffer.from(JSON.stringify({ t: ts, id })).toString("base64url");

export function decodeCursor(cursor?: string): { t: string; id: string } | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (typeof v.t === "string" && !Number.isNaN(Date.parse(v.t)) && typeof v.id === "string" && UUID_RE.test(v.id)) return { t: v.t, id: v.id };
  } catch {
    /* cai no erro abaixo */
  }
  throw new HttpError(400, "Cursor inválido");
}
