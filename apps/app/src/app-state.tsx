import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, BackHandler } from "react-native";
import type { CategoryMeta, Meta, StatusMeta } from "@sinaly/shared";
import { api } from "./api";

// ---------- Navegação ----------
// O app tem poucas telas: abas fixas + uma pilha de telas por cima. Um navegador próprio de ~40 linhas
// evita duas dependências nativas a mais (e as incompatibilidades de versão que vêm com elas).
export type Tab = "map" | "mine" | "notifications" | "profile";
export type Route = { name: "new"; at?: { lat: number; lng: number } } | { name: "detail"; id: string };

type Nav = {
  tab: Tab;
  setTab: (t: Tab) => void;
  stack: Route[];
  push: (r: Route) => void;
  pop: () => void;
};

// ---------- Dados compartilhados ----------
type Data = {
  meta: Meta | null;
  metaError: string | null;
  reloadMeta: () => void;
  category: (slug: string) => CategoryMeta | undefined;
  status: (slug: string) => StatusMeta | undefined;
  /** Muda sempre que o cidadão cria algo: mapa e listas recarregam. */
  version: number;
  bump: () => void;
  unread: number;
  refreshUnread: () => void;
};

const NavCtx = createContext<Nav | null>(null);
const DataCtx = createContext<Data | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>("map");
  const [stack, setStack] = useState<Route[]>([]);
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  // Botão "voltar" do Android: fecha a tela de cima; nas abas, volta para o mapa antes de sair do app.
  const navRef = useRef({ stack, tab });
  navRef.current = { stack, tab };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (navRef.current.stack.length > 0) return pop(), true;
      if (navRef.current.tab !== "map") return setTab("map"), true;
      return false;
    });
    return () => sub.remove();
  }, [pop]);

  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const loadMeta = useCallback(() => {
    setMetaError(null);
    api.meta().then(setMeta, (e: Error) => setMetaError(e.message));
  }, []);
  useEffect(loadMeta, [loadMeta]);
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const maps = useMemo(
    () => ({ cat: new Map(meta?.categories.map((c) => [c.slug, c])), st: new Map(meta?.statuses.map((s) => [s.slug, s])) }),
    [meta],
  );

  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Contador de não lidas: consulta leve (limit=1) a cada 60 s, só com o app em primeiro plano.
  const [unread, setUnread] = useState(0);
  const refreshUnread = useCallback(() => {
    api.unreadCount().then((r) => setUnread(r.unreadCount), () => undefined);
  }, []);
  useEffect(() => {
    refreshUnread();
    let timer: ReturnType<typeof setInterval> | null = setInterval(refreshUnread, 60_000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        refreshUnread();
        if (!metaRef.current) loadMeta(); // abriu o app sem rede: tenta de novo ao voltar
        timer ??= setInterval(refreshUnread, 60_000);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      sub.remove();
      if (timer) clearInterval(timer);
    };
  }, [refreshUnread, loadMeta]);

  const nav = useMemo(() => ({ tab, setTab, stack, push, pop }), [tab, stack, push, pop]);
  const data = useMemo<Data>(
    () => ({
      meta,
      metaError,
      reloadMeta: loadMeta,
      category: (s) => maps.cat.get(s),
      status: (s) => maps.st.get(s),
      version,
      bump,
      unread,
      refreshUnread,
    }),
    [meta, metaError, loadMeta, maps, version, bump, unread, refreshUnread],
  );

  return (
    <NavCtx.Provider value={nav}>
      <DataCtx.Provider value={data}>{children}</DataCtx.Provider>
    </NavCtx.Provider>
  );
}

export function useNav() {
  const c = useContext(NavCtx);
  if (!c) throw new Error("useNav fora do AppStateProvider");
  return c;
}
export function useData() {
  const c = useContext(DataCtx);
  if (!c) throw new Error("useData fora do AppStateProvider");
  return c;
}
