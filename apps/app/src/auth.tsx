import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, refreshSession, session, type Me, type Tokens } from "./api";

type State =
  | { kind: "loading" }
  | { kind: "offline"; message: string } // tem sessão salva, mas a API não respondeu
  | { kind: "signedOut" }
  | { kind: "signedIn"; me: Me };

type AuthCtx = {
  state: State;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  completeOnboarding: (body: unknown) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const start = useCallback(async (tokens: Tokens) => {
    await session.save(tokens);
    const me = await api.me();
    if (me.role !== "cidadao") {
      // O app é só do cidadão; funcionário usa o painel (a API já recusa o login, isto é defesa extra).
      await api.logout().catch(() => undefined);
      await session.clear();
      throw new ApiError(403, "Esta conta é de funcionário. Use o painel da prefeitura.");
    }
    setState({ kind: "signedIn", me });
  }, []);

  // Ao abrir o app: tenta retomar a sessão salva.
  const boot = useCallback(async () => {
    setState({ kind: "loading" });
    if (!(await session.hasStoredSession())) return setState({ kind: "signedOut" });
    try {
      await refreshSession();
      const me = await api.me();
      setState({ kind: "signedIn", me });
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) return setState({ kind: "offline", message: e.message });
      await session.clear();
      setState({ kind: "signedOut" });
    }
  }, []);

  useEffect(() => {
    session.onLost(() => setState({ kind: "signedOut" }));
    void boot();
    return () => session.onLost(null);
  }, [boot]);

  const value = useMemo<AuthCtx>(
    () => ({
      state,
      login: async (email, password) => start(await api.login(email, password)),
      register: async (email, password) => start(await api.register(email, password)),
      completeOnboarding: async (body) => {
        await api.onboarding(body);
        setState({ kind: "signedIn", me: await api.me() });
      },
      logout: async () => {
        // Revoga no servidor (best effort) e apaga o token local mesmo sem rede.
        await api.logout().catch(() => undefined);
        await session.clear();
        setState({ kind: "signedOut" });
      },
      retry: () => void boot(),
    }),
    [state, start, boot],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fora do AuthProvider");
  return c;
}
