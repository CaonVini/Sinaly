import { asc } from "drizzle-orm";
import { RESOLVED_VISIBLE_DAYS, type CategoryMeta, type IconKey, type Meta, type StatusMeta } from "@sinaly/shared";
import { db } from "./db/client.js";
import { categories, statuses } from "./db/schema.js";

// Categorias/status mudam raramente e são lidos em quase toda requisição: cache curto em memória.
// Toda escrita de configuração invalida o cache; o TTL cobre o caso de mais de uma instância da API.
const TTL_MS = 5_000;

type Cached = { at: number; meta: Meta; cat: Map<string, CategoryMeta>; st: Map<string, StatusMeta> };
let cached: Cached | null = null;
let inflight: Promise<Cached> | null = null;

async function load(): Promise<Cached> {
  const [cats, sts] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sort), asc(categories.name)),
    db.select().from(statuses).orderBy(asc(statuses.sort), asc(statuses.name)),
  ]);
  const categoryList: CategoryMeta[] = cats.map((c) => ({ slug: c.slug, name: c.name, color: c.color, icon: c.icon as IconKey, active: c.active, system: c.system, sort: c.sort }));
  const statusList: StatusMeta[] = sts.map((s) => ({ slug: s.slug, name: s.name, color: s.color, kind: s.kind, isEntry: s.isEntry, active: s.active, system: s.system, sort: s.sort }));
  return {
    at: Date.now(),
    meta: { categories: categoryList, statuses: statusList, resolvedVisibleDays: RESOLVED_VISIBLE_DAYS },
    cat: new Map(categoryList.map((c) => [c.slug, c])),
    st: new Map(statusList.map((s) => [s.slug, s])),
  };
}

export async function getMeta(): Promise<Cached> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached;
  // Requisições simultâneas compartilham a mesma consulta (evita estouro de leituras quando o cache expira).
  inflight ??= load()
    .then((c) => (cached = c))
    .finally(() => (inflight = null));
  return inflight;
}

export const invalidateMeta = () => {
  cached = null;
};
