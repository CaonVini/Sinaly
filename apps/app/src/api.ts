import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { Category, Meta, Status } from "@sinaly/shared";
import { API_URL } from "./config";

// ---------- Tipos das respostas da API ----------
export type Tokens = { accessToken: string; refreshToken: string; expiresIn: string };
export type Me = { id: string; email: string; role: string; name: string | null; onboardingComplete: boolean };
export type HistoryEntry = { from: Status | null; to: Status; note: string | null; at: string };
export type Occurrence = {
  id: string;
  category: Category;
  description: string;
  neighborhood: string | null;
  status: Status;
  lat: number;
  lng: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  photoUrl: string | null;
  thumbUrl: string | null;
  history?: HistoryEntry[];
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type Notification = {
  id: string;
  occurrenceId: string | null;
  type: string;
  title: string;
  body: string | null;
  fromStatus: Status | null;
  toStatus: Status | null;
  readAt: string | null;
  createdAt: string;
};
export type Bbox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, string[] | undefined>,
  ) {
    super(message);
  }
}

// ---------- Tokens ----------
// Access token (15 min) fica só em memória. O refresh token (30 dias) vai para o armazenamento
// cifrado do sistema (Keychain no iOS, Keystore no Android). Na web não há cofre: fica só na memória.
const REFRESH_KEY = "sinaly.refresh";
let accessToken: string | null = null;
let refreshInflight: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

const store = {
  get: () => (Platform.OS === "web" ? Promise.resolve(null) : SecureStore.getItemAsync(REFRESH_KEY)),
  set: (v: string) => (Platform.OS === "web" ? Promise.resolve() : SecureStore.setItemAsync(REFRESH_KEY, v)),
  clear: () => (Platform.OS === "web" ? Promise.resolve() : SecureStore.deleteItemAsync(REFRESH_KEY)),
};

export const session = {
  getAccessToken: () => accessToken,
  hasStoredSession: async () => !!(await store.get()),
  async save(t: Tokens) {
    accessToken = t.accessToken;
    await store.set(t.refreshToken);
  },
  async clear() {
    accessToken = null;
    await store.clear();
  },
  /** Chamado quando a sessão é invalidada no servidor (logout em outro lugar, refresh reutilizado, conta desativada). */
  onLost(cb: (() => void) | null) {
    onSessionLost = cb;
  },
};

/**
 * Renova o access token. Várias requisições que recebem 401 ao mesmo tempo compartilham UMA renovação:
 * o refresh token é de uso único e a API derruba a sessão inteira se ele for reapresentado.
 */
export function refreshSession(): Promise<boolean> {
  refreshInflight ??= (async () => {
    const refreshToken = await store.get();
    if (!refreshToken) return false;
    try {
      const t = await raw<Tokens>("/auth/refresh", { method: "POST", body: { refreshToken } });
      await session.save(t);
      return true;
    } catch (e) {
      // Só descarta a sessão se a API disse que ela é inválida; erro de rede mantém o token para tentar depois.
      if (e instanceof ApiError && e.status === 401) await session.clear();
      throw e;
    }
  })().finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
}

// ---------- HTTP ----------
type Opts = { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined>; signal?: AbortSignal; timeoutMs?: number };

const qs = (q?: Opts["query"]) => {
  if (!q) return "";
  const p = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join("&")}` : "";
};

async function raw<T>(path: string, opts: Opts = {}, auth = false): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs(opts.query)}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e; // cancelado por quem chamou: não é erro de rede
    if (ctrl.signal.aborted) throw new ApiError(0, "A API demorou demais para responder.");
    // Falha de rede vem como TypeError; qualquer outra coisa (ex.: corpo que o fetch não sabe montar) é bug do app,
    // e mostrar "sem conexão" nesse caso esconderia a causa.
    if (e instanceof TypeError) throw new ApiError(0, `Sem conexão com a API (${API_URL}).`);
    throw new ApiError(-1, `Falha ao preparar a requisição: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string; details?: Record<string, string[]> } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Erro ${res.status}`, data?.details);
  return data as T;
}

/** Requisição autenticada: em 401 renova o token uma vez e repete; se não der, encerra a sessão local. */
async function authed<T>(path: string, opts: Opts = {}): Promise<T> {
  try {
    return await raw<T>(path, opts, true);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    let ok = false;
    try {
      ok = await refreshSession();
    } catch (re) {
      if (re instanceof ApiError && re.status === 401) onSessionLost?.();
      throw re instanceof ApiError && re.status === 401 ? new ApiError(401, "Sua sessão expirou. Entre novamente.") : re;
    }
    if (!ok) {
      onSessionLost?.();
      throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
    }
    return raw<T>(path, opts, true);
  }
}

/** URL absoluta + cabeçalho para <Image>: a foto de ocorrência ainda não verificada só é entregue ao autor. */
export const photoSource = (path: string) => ({
  uri: `${API_URL}${path}`,
  headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
});

// ---------- Rotas ----------
export const api = {
  login: (email: string, password: string) => raw<Tokens & { role: string }>("/auth/login", { method: "POST", body: { email, password } }),
  register: (email: string, password: string) => raw<Tokens & { onboardingComplete: boolean }>("/auth/register", { method: "POST", body: { email, password } }),
  logout: () => authed<void>("/auth/logout", { method: "POST" }),
  me: () => authed<Me>("/me"),
  onboarding: (body: unknown) => authed<{ onboardingComplete: true }>("/me/onboarding", { method: "POST", body }),
  meta: () => raw<Meta>("/meta"),

  map: (bbox: Bbox, includeResolved: boolean, category: string | undefined, signal?: AbortSignal) =>
    raw<{ items: Occurrence[]; truncated: boolean }>("/occurrences/map", {
      query: { bbox: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`, includeResolved, category },
      signal,
    }),
  occurrence: (id: string) => authed<Occurrence>(`/occurrences/${encodeURIComponent(id)}`),
  myOccurrences: (cursor?: string, status?: string, limit = 30) => authed<Page<Occurrence>>("/me/occurrences", { query: { cursor, status, limit } }),
  createOccurrence: (form: FormData) => authed<Occurrence>("/occurrences", { method: "POST", body: form, timeoutMs: 60_000 }),

  notifications: (cursor?: string) => authed<Page<Notification> & { unreadCount: number }>("/me/notifications", { query: { cursor } }),
  unreadCount: () => authed<{ unreadCount: number }>("/me/notifications", { query: { limit: 1, unread: true } }),
  markRead: (id: string) => authed<void>(`/me/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  markAllRead: () => authed<{ updated: number }>("/me/notifications/read-all", { method: "POST" }),
  clearNotifications: () => authed<{ removed: number }>("/me/notifications", { method: "DELETE" }),

  /** Bairro do ponto marcado. A consulta passa pela API (que cuida do limite de uso do serviço de mapas), nunca direto do celular. */
  reverseGeocode: (lat: number, lng: number) => authed<{ enabled: boolean; neighborhood: string | null }>("/geocode/reverse", { query: { lat, lng } }),
};
