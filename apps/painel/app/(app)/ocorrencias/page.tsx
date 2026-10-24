"use client";
import { CATEGORIES, CATEGORY_LABELS, STATUSES, STATUS_LABELS, type Category, type Status } from "@sinaly/shared";
import { Loader2, MapPinned, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { NewOccurrenceSheet } from "@/components/new-occurrence-sheet";
import { OccurrenceSheet } from "@/components/occurrence-sheet";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Occurrence, type Stats, useApi } from "@/lib/client";
import { cn, timeAgo } from "@/lib/utils";

const OccurrenceMap = dynamic(() => import("@/components/occurrence-map").then((m) => m.OccurrenceMap), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

type Page = { items: Occurrence[]; nextCursor: string | null };
const ALL = "all";

function Content() {
  const router = useRouter();
  const sp = useSearchParams();
  const status = (STATUSES as readonly string[]).includes(sp.get("status") ?? "") ? (sp.get("status") as Status) : null;
  const category = (CATEGORIES as readonly string[]).includes(sp.get("category") ?? "") ? (sp.get("category") as Category) : null;
  const selected = sp.get("id");

  const [items, setItems] = useState<Occurrence[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const stats = useApi<Stats>("staff/stats");
  const reloadStats = stats.reload;

  const qs = new URLSearchParams({ limit: "50", ...(status ? { status } : {}), ...(category ? { category } : {}) }).toString();

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    api<Page>(`staff/occurrences?${qs}`, { signal: ctl.signal })
      .then((p) => {
        setItems(p.items);
        setCursor(p.nextCursor);
        setError(null);
      })
      .catch((e) => e?.name !== "AbortError" && setError(e.message))
      .finally(() => !ctl.signal.aborted && setLoading(false));
    return () => ctl.abort();
  }, [qs, version]);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const p = await api<Page>(`staff/occurrences?${qs}&cursor=${encodeURIComponent(cursor)}`);
      setItems((cur) => [...cur, ...p.items]);
      setCursor(p.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  const setParam = useCallback(
    (k: string, v: string | null) => {
      const n = new URLSearchParams(sp.toString());
      if (v) n.set(k, v);
      else n.delete(k);
      router.replace(`/ocorrencias${n.size ? `?${n}` : ""}`, { scroll: false });
    },
    [router, sp],
  );

  const count = (s: Status) => stats.data?.byStatus[s];
  const total = stats.data ? STATUSES.reduce((a, k) => a + (stats.data!.byStatus[k] ?? 0), 0) : undefined;

  return (
    <div className="flex h-dvh flex-col">
      <header className="space-y-3 border-b bg-card px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Ocorrências</h1>
          <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setCreating(true)}><Plus /> Nova ocorrência</Button>
          <div className="w-48">
            <Select value={category ?? ALL} onValueChange={(v) => setParam("category", v === ALL ? null : v)}>
              <SelectTrigger aria-label="Categoria"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as categorias</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          </div>
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Filtrar por status">
          {[{ key: null, label: "Todas", n: total }, ...STATUSES.map((s) => ({ key: s as Status | null, label: STATUS_LABELS[s], n: count(s) }))].map((t) => (
            <button
              key={t.key ?? "all"}
              role="tab"
              aria-selected={status === t.key}
              onClick={() => setParam("status", t.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                status === t.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {t.label}
              {t.n !== undefined && <span className="rounded-full bg-background px-1.5 text-xs tabular-nums">{t.n}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(22rem,30rem)_1fr]">
        <section className="min-h-0 overflow-y-auto border-r bg-card" aria-label="Lista de ocorrências">
          {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
          <ul className="divide-y">
            {items.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => setParam("id", o.id)}
                  className={cn("flex w-full gap-3 p-4 text-left transition-colors hover:bg-accent/50", selected === o.id && "bg-accent/70")}
                >
                  <span className="size-16 shrink-0 overflow-hidden rounded-md border bg-muted">
                    {o.thumbUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/proxy/${o.thumbUrl.replace(/^\//, "")}`} alt="" loading="lazy" className="size-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{CATEGORY_LABELS[o.category]}</span>
                      <span className="text-xs text-muted-foreground">{timeAgo(o.createdAt)}</span>
                    </span>
                    <span className="line-clamp-2 block text-sm text-muted-foreground">{o.description}</span>
                    <StatusBadge status={o.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {loading && items.length === 0 && <div className="space-y-3 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <MapPinned className="size-6" /> Nenhuma ocorrência neste filtro.
            </div>
          )}
          {cursor && (
            <div className="p-4">
              <Button variant="outline" className="w-full" onClick={more} disabled={loading}>{loading && <Loader2 className="animate-spin" />} Carregar mais</Button>
            </div>
          )}
        </section>

        <section className="hidden min-h-0 lg:block" aria-label="Mapa">
          <OccurrenceMap items={items} selectedId={selected} onSelect={(id) => setParam("id", id)} fitKey={qs} />
        </section>
      </div>

      <NewOccurrenceSheet
        open={creating}
        onClose={() => setCreating(false)}
        center={items[0] ? { lat: items[0].lat, lng: items[0].lng } : null}
        onCreated={(o) => {
          setCreating(false);
          setVersion((v) => v + 1);
          reloadStats();
          setParam("id", o.id);
        }}
      />
      <OccurrenceSheet id={selected} onClose={() => setParam("id", null)} onChanged={() => (setVersion((v) => v + 1), reloadStats())} />
    </div>
  );
}

export default function OccurrencesPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
