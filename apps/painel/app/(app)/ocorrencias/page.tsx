"use client";
import { CATEGORIES, CATEGORY_LABELS, STATUSES, STATUS_LABELS, type Category, type Status } from "@sinaly/shared";
import { ChevronRight, Clock, ImageOff, Loader2, MapPin, MapPinned, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { NewOccurrenceSheet } from "@/components/new-occurrence-sheet";
import { CategoryIcon } from "@/components/category-icon";
import { OccurrenceSheet } from "@/components/occurrence-sheet";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Occurrence, type Stats, useApi } from "@/lib/client";
import { cn, timeAgo, titleOf } from "@/lib/utils";

const OccurrenceMap = dynamic(() => import("@/components/occurrence-map").then((m) => m.OccurrenceMap), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

type Page = { items: Occurrence[]; nextCursor: string | null; total: number };
const ALL = "all";

function Content() {
  const router = useRouter();
  const sp = useSearchParams();
  const status = (STATUSES as readonly string[]).includes(sp.get("status") ?? "") ? (sp.get("status") as Status) : null;
  const category = (CATEGORIES as readonly string[]).includes(sp.get("category") ?? "") ? (sp.get("category") as Category) : null;
  const order = sp.get("order") === "asc" ? "asc" : "desc";
  const selected = sp.get("id");

  const [items, setItems] = useState<Occurrence[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [matching, setMatching] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const stats = useApi<Stats>("staff/stats");
  const reloadStats = stats.reload;

  const qs = new URLSearchParams({ limit: "50", order, ...(status ? { status } : {}), ...(category ? { category } : {}) }).toString();

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    api<Page>(`staff/occurrences?${qs}`, { signal: ctl.signal })
      .then((p) => {
        setItems(p.items);
        setCursor(p.nextCursor);
        setMatching(p.total);
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
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar por status">
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

      <div className="grid min-h-0 flex-1 lg:grid-cols-[22rem_1fr] 2xl:grid-cols-[24rem_1fr]">
        <section className="flex min-h-0 flex-col border-r bg-muted/30" aria-label="Lista de ocorrências">
          <div className="flex items-center justify-between gap-2 border-b bg-card px-3 py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="whitespace-nowrap">Ordenar por</span>
              <div className="w-36">
                <Select value={order} onValueChange={(v) => setParam("order", v === "asc" ? "asc" : null)}>
                  <SelectTrigger aria-label="Ordenar por" className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Mais recentes</SelectItem>
                    <SelectItem value="asc">Mais antigas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <span className="text-sm whitespace-nowrap text-muted-foreground tabular-nums" aria-live="polite">
              {matching === null ? "" : `${matching} ${matching === 1 ? "ocorrência" : "ocorrências"}`}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
            <ul className="space-y-2 p-2.5">
              {items.map((o) => (
                <li key={o.id}>
                  <button
                    onClick={() => setParam("id", o.id)}
                    aria-current={selected === o.id}
                    className={cn(
                      "flex w-full gap-3 rounded-xl border bg-card p-3 text-left shadow-xs transition-colors hover:border-primary/40",
                      selected === o.id && "border-primary bg-accent/50 ring-1 ring-primary",
                    )}
                  >
                    <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
                      {o.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/proxy/${o.thumbUrl.replace(/^\//, "")}`} alt="" loading="lazy" className="size-full object-cover" />
                      ) : (
                        <ImageOff className="size-5" aria-label="Sem foto" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-[0.95rem] leading-snug font-semibold">{titleOf(o.description)}</span>
                        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><CategoryIcon category={o.category} className="size-3.5 shrink-0" /> {CATEGORY_LABELS[o.category]}</span>
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="size-3.5 shrink-0" />
                        <span className="truncate">{o.neighborhood ?? "Bairro não informado"}</span>
                      </span>
                      <span className="mt-auto flex items-end justify-between gap-2 pt-0.5">
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="size-3.5" /> {timeAgo(o.createdAt)}</span>
                        <StatusBadge status={o.status} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {loading && items.length === 0 && <div className="space-y-2.5 p-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>}
            {!loading && !error && items.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <MapPinned className="size-6" /> Nenhuma ocorrência neste filtro.
              </div>
            )}
            {cursor && (
              <div className="px-3 pb-4">
                <Button variant="outline" className="w-full" onClick={more} disabled={loading}>{loading && <Loader2 className="animate-spin" />} Carregar mais</Button>
              </div>
            )}
          </div>
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
