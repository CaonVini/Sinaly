"use client";
import { CATEGORIES, CATEGORY_LABELS, SOURCE_LABELS, STATUSES, STATUS_LABELS, type Category, type Status } from "@sinaly/shared";
import { Download, ImageIcon, Loader2, Phone, Plus, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { NewOccurrenceSheet } from "@/components/new-occurrence-sheet";
import { OccurrenceSheet } from "@/components/occurrence-sheet";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Occurrence } from "@/lib/client";
import { download, toCsv } from "@/lib/csv";
import { fmtDateTime } from "@/lib/utils";

type Page = { items: Occurrence[]; nextCursor: string | null };
const ALL = "all";
const EXPORT_CAP = 20000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function Content() {
  const router = useRouter();
  const sp = useSearchParams();
  const status = (STATUSES as readonly string[]).includes(sp.get("status") ?? "") ? (sp.get("status") as Status) : null;
  const category = (CATEGORIES as readonly string[]).includes(sp.get("category") ?? "") ? (sp.get("category") as Category) : null;
  const from = DATE.test(sp.get("from") ?? "") ? sp.get("from")! : "";
  const to = DATE.test(sp.get("to") ?? "") ? sp.get("to")! : "";
  const selected = sp.get("id");

  const [items, setItems] = useState<Occurrence[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null);

  const filters = useMemo(
    () => new URLSearchParams({ ...(status ? { status } : {}), ...(category ? { category } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }),
    [status, category, from, to],
  );
  const qs = new URLSearchParams(filters);
  qs.set("limit", "50");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs.toString(), version]);

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

  /** Exporta TUDO que bate com os filtros (não só a página carregada), de 100 em 100. */
  async function exportCsv() {
    setExporting(0);
    setError(null);
    try {
      const all: Occurrence[] = [];
      let cur: string | null = null;
      do {
        const p: Page = await api<Page>(`staff/occurrences?${filters}&limit=100${cur ? `&cursor=${encodeURIComponent(cur)}` : ""}`);
        all.push(...p.items);
        cur = p.nextCursor;
        setExporting(all.length);
      } while (cur && all.length < EXPORT_CAP);
      download(`sinaly-ocorrencias-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(all));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao exportar");
    } finally {
      setExporting(null);
    }
  }

  const setParam = useCallback(
    (k: string, v: string | null) => {
      const n = new URLSearchParams(sp.toString());
      if (v) n.set(k, v);
      else n.delete(k);
      router.replace(`/planilha${n.size ? `?${n}` : ""}`, { scroll: false });
    },
    [router, sp],
  );

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter((o) => `${o.description} ${o.authorName ?? ""} ${o.contact?.name ?? ""} ${o.id.slice(0, 8)}`.toLowerCase().includes(t)) : items;
  }, [items, q]);
  const first = items[0];

  return (
    <div className="flex h-dvh flex-col">
      <header className="space-y-3 border-b bg-card px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Planilha</h1>
            <p className="text-xs text-muted-foreground">Todas as ocorrências em tabela. Exporte para abrir no Excel.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={exporting !== null}>
              {exporting !== null ? <Loader2 className="animate-spin" /> : <Download />}
              {exporting !== null ? `Exportando ${exporting}…` : "Exportar CSV"}
            </Button>
            <Button onClick={() => setCreating(true)}><Plus /> Nova ocorrência</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar na descrição, nome ou protocolo" aria-label="Buscar" className="pl-8" />
          </div>
          <div className="w-44">
            <Select value={status ?? ALL} onValueChange={(v) => setParam("status", v === ALL ? null : v)}>
              <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os status</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-52">
            <Select value={category ?? ALL} onValueChange={(v) => setParam("category", v === ALL ? null : v)}>
              <SelectTrigger aria-label="Categoria"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as categorias</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">De <Input type="date" value={from} max={to || undefined} onChange={(e) => setParam("from", e.target.value || null)} className="w-36" aria-label="Data inicial" /></label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">até <Input type="date" value={to} min={from || undefined} onChange={(e) => setParam("to", e.target.value || null)} className="w-36" aria-label="Data final" /></label>
        </div>
      </header>

      {error && <p role="alert" className="border-b bg-destructive/10 px-6 py-2 text-sm text-destructive">{error}</p>}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              {["Protocolo", "Registrada em", "Categoria", "Status", "Descrição", "Origem", "Registrada por", ""].map((h) => (
                <th key={h} className="border-b px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id} onClick={() => setParam("id", o.id)} className="cursor-pointer border-b transition-colors hover:bg-accent/50 data-[sel=true]:bg-accent/70" data-sel={selected === o.id}>
                <td className="px-4 py-2.5 font-mono text-xs">
                  <button className="font-mono underline-offset-2 hover:underline" onClick={(e) => (e.stopPropagation(), setParam("id", o.id))}>{o.id.slice(0, 8).toUpperCase()}</button>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{fmtDateTime(o.createdAt)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{CATEGORY_LABELS[o.category]}</td>
                <td className="px-4 py-2.5"><StatusBadge status={o.status} /></td>
                <td className="max-w-md px-4 py-2.5"><span className="line-clamp-2">{o.description}</span></td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">{o.source === "prefeitura" && <Phone className="size-3.5 text-muted-foreground" />}{o.source ? SOURCE_LABELS[o.source] : "—"}</span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">{o.authorName ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{o.photoUrl && <ImageIcon className="size-4" aria-label="Tem foto" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && items.length === 0 && <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>}
        {!loading && !error && shown.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">Nenhuma ocorrência neste filtro.</p>}
        <div className="flex items-center justify-between gap-3 p-4 text-xs text-muted-foreground">
          <span>{shown.length} exibidas{q ? ` (de ${items.length} carregadas)` : ""}{cursor ? " · há mais registros" : ""}</span>
          {cursor && <Button variant="outline" size="sm" onClick={more} disabled={loading}>{loading && <Loader2 className="animate-spin" />} Carregar mais</Button>}
        </div>
      </div>

      <OccurrenceSheet id={selected} onClose={() => setParam("id", null)} onChanged={() => setVersion((v) => v + 1)} />
      <NewOccurrenceSheet
        open={creating}
        onClose={() => setCreating(false)}
        center={first ? { lat: first.lat, lng: first.lng } : null}
        onCreated={(o) => {
          setCreating(false);
          setVersion((v) => v + 1);
          setParam("id", o.id);
        }}
      />
    </div>
  );
}

export default function PlanilhaPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
