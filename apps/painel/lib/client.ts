"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Category, Status } from "@sinaly/shared";

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
  authorName?: string | null;
  source?: "app" | "prefeitura";
  contact?: { name: string | null; phone: string | null } | null;
  history?: { from: Status | null; to: Status; note: string | null; at: string }[];
};

export type AuditEntry = {
  id: number;
  action: string;
  actorName: string | null;
  actorRole: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  at: string;
};

export type Stats = {
  byStatus: Partial<Record<Status, number>>;
  byCategory: Partial<Record<Category, number>>;
  avgResolutionHours: number | null;
  perDay: { day: string; total: number }[];
  unverifiedOver24h: number;
};

export type Activity = {
  id: number;
  action: string;
  occurrenceId: string;
  actorName: string | null;
  actorRole: string;
  changes: Record<string, { from?: unknown; to: unknown }>;
  at: string;
  category: Category;
  description: string;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Fala com a API através do proxy do painel (cookies httpOnly; sem token no JS). */
export async function api<T>(path: string, init?: { method?: "GET" | "PATCH" | "POST"; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const form = init?.body instanceof FormData;
  const res = await fetch(`/api/proxy/${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body && !form ? { "content-type": "application/json" } : undefined, // multipart: o navegador define o boundary
    body: init?.body ? (form ? (init.body as FormData) : JSON.stringify(init.body)) : undefined,
    signal: init?.signal,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    window.location.href = "/login"; // sessão expirou ou foi revogada
    throw new ApiError(401, "Sessão expirada");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? "Erro inesperado");
  return data as T;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!path) return;
    const ctl = new AbortController();
    setLoading(true);
    api<T>(path, { signal: ctl.signal })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError(e.message);
      })
      .finally(() => !ctl.signal.aborted && setLoading(false));
    return () => ctl.abort();
  }, [path, tick]);
  return { data, error, loading, reload };
}

export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}
