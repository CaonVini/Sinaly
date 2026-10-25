"use client";
import { SYSTEM_CATEGORIES, SYSTEM_STATUSES, RESOLVED_VISIBLE_DAYS, canTransition, type CategoryMeta, type Meta, type StatusMeta } from "@sinaly/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/client";

// Valores vêm do banco e viram variáveis CSS: valida o formato antes de aplicar.
const HEX = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z0-9_]{2,40}$/;

// Enquanto /meta não responde, a tela já mostra os nomes e cores dos itens do sistema (sem "piscar" vazio).
const FALLBACK: Meta = {
  categories: SYSTEM_CATEGORIES.map((c, i) => ({ ...c, active: true, system: true, sort: i })),
  statuses: SYSTEM_STATUSES.map((s, i) => ({ ...s, active: true, system: true, sort: i })),
  resolvedVisibleDays: RESOLVED_VISIBLE_DAYS,
};

type Ctx = {
  meta: Meta;
  loaded: boolean;
  reload: () => Promise<void>;
  status: (slug: string) => StatusMeta | undefined;
  category: (slug: string) => CategoryMeta | undefined;
  statusName: (slug: string | null | undefined) => string;
  categoryName: (slug: string | null | undefined) => string;
  /** Destinos permitidos a partir de um status (as mesmas regras da API). */
  targets: (from: string) => StatusMeta[];
};

const MetaContext = createContext<Ctx | null>(null);

export function MetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta>(FALLBACK);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setMeta(await api<Meta>("meta"));
      setLoaded(true);
    } catch {
      /* mantém o que já tinha */
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  // --st-<slug> e --cat-<slug> alimentam selos, barras e legenda. Via CSSOM (setProperty), compatível com a CSP.
  useEffect(() => {
    const root = document.documentElement.style;
    const set: string[] = [];
    for (const [prefix, list] of [["st", meta.statuses], ["cat", meta.categories]] as const) {
      for (const it of list) {
        if (SLUG.test(it.slug) && HEX.test(it.color)) {
          root.setProperty(`--${prefix}-${it.slug}`, it.color);
          set.push(`--${prefix}-${it.slug}`);
        }
      }
    }
    return () => set.forEach((n) => root.removeProperty(n));
  }, [meta]);

  const value = useMemo<Ctx>(() => {
    const st = new Map(meta.statuses.map((s) => [s.slug, s]));
    const cat = new Map(meta.categories.map((c) => [c.slug, c]));
    return {
      meta,
      loaded,
      reload,
      status: (s) => st.get(s),
      category: (c) => cat.get(c),
      statusName: (s) => (s ? (st.get(s)?.name ?? s) : "—"),
      categoryName: (c) => (c ? (cat.get(c)?.name ?? c) : "—"),
      targets: (from) => {
        const f = st.get(from);
        return f ? meta.statuses.filter((t) => canTransition(f, t)) : [];
      },
    };
  }, [meta, loaded, reload]);

  return <MetaContext.Provider value={value}>{children}</MetaContext.Provider>;
}

export function useMeta(): Ctx {
  const v = useContext(MetaContext);
  if (!v) throw new Error("useMeta fora do MetaProvider");
  return v;
}
