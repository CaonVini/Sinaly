"use client";
import { CheckCircle2, Clock, Download, Inbox, MapPinOff, Sigma } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, type ReactNode } from "react";
import { statusColor } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/client";
import { download, tableToCsv } from "@/lib/csv";
import { useMeta } from "@/lib/meta";
import { cn } from "@/lib/utils";

type Row = { key: string; total: number; resolved: number; open: number; avgHours: number | null };
type Report = {
  grain: "day" | "month";
  totals: { total: number; resolved: number; open: number; rejected: number; noNeighborhood: number; avgResolutionHours: number | null; medianResolutionHours: number | null };
  byNeighborhood: Row[];
  byCategory: Row[];
  byStatus: { key: string; total: number }[];
  byPeriod: { key: string; total: number; resolved: number }[];
  resolutionBuckets: { lt1d: number; d1to3: number; d3to7: number; gt7d: number };
};

const ALL = "all";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9_]{2,40}$/;
const NO_HOOD = "Sem bairro";

const hours = (h: number | null) => (h === null ? "—" : h < 48 ? `${h.toLocaleString("pt-BR")} h` : `${(h / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`);
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const periodLabel = (k: string) => (k.length === 7 ? `${k.slice(5)}/${k.slice(0, 4)}` : `${k.slice(8)}/${k.slice(5, 7)}`);

const PRESETS = [
  { label: "7 dias", days: 6 },
  { label: "30 dias", days: 29 },
  { label: "90 dias", days: 89 },
  { label: "Tudo", days: null },
] as const;

function Kpi({ title, value, hint, icon }: { title: string; value: ReactNode; hint: string; icon: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{title}</CardTitle>
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Panel({ title, onExport, children, className }: { title: string; onExport?: () => void; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle>{title}</CardTitle>
        {onExport && (
          <Button variant="ghost" size="sm" onClick={onExport} aria-label={`Exportar ${title} em CSV`}>
            <Download /> CSV
          </Button>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Tabela com barra proporcional ao total (bairro e categoria). */
function RankTable({ rows, label, color }: { rows: Row[]; label: (k: string) => ReactNode; color?: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Sem dados no período.</p>;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full min-w-[30rem] border-collapse text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">Nome</th>
            <th className="w-1/3 py-2 pr-3 font-medium">Total</th>
            <th className="py-2 pr-3 text-right font-medium">Em aberto</th>
            <th className="py-2 pr-3 text-right font-medium">Resolvidas</th>
            <th className="py-2 text-right font-medium">Tempo médio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="max-w-48 truncate py-2 pr-3 font-medium">{label(r.key)}</td>
              <td className="py-2 pr-3">
                <span className="flex items-center gap-2">
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full" style={{ width: `${(r.total / max) * 100}%`, background: color?.(r.key) ?? "var(--primary)" }} />
                  </span>
                  <span className="w-8 text-right tabular-nums">{r.total}</span>
                </span>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.open}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.resolved}</td>
              <td className="py-2 text-right tabular-nums">{hours(r.avgHours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Content() {
  const router = useRouter();
  const sp = useSearchParams();
  const { meta, categoryName, statusName } = useMeta();
  const from = DATE.test(sp.get("from") ?? "") ? sp.get("from")! : "";
  const to = DATE.test(sp.get("to") ?? "") ? sp.get("to")! : "";
  const category = SLUG.test(sp.get("category") ?? "") ? sp.get("category")! : "";
  const status = SLUG.test(sp.get("status") ?? "") ? sp.get("status")! : "";

  const qs = useMemo(() => new URLSearchParams({ ...(from && { from }), ...(to && { to }), ...(category && { category }), ...(status && { status }) }).toString(), [from, to, category, status]);
  const { data, error, loading } = useApi<Report>(`staff/reports${qs ? `?${qs}` : ""}`);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const n = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
      router.replace(`/relatorios${n.size ? `?${n}` : ""}`, { scroll: false });
    },
    [router, sp],
  );

  const t = data?.totals;
  const stamp = new Date().toISOString().slice(0, 10);
  const scope = [from && `de ${from}`, to && `até ${to}`, category && categoryName(category), status && statusName(status)].filter(Boolean).join(", ") || "todo o período";
  const rowsCsv = (rows: Row[], name: (k: string) => string) => rows.map((r) => [name(r.key), r.total, r.open, r.resolved, r.avgHours ?? ""]);
  const head = (first: string) => [first, "Total", "Em aberto", "Resolvidas", "Tempo médio de resolução (h)"];

  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Números consolidados por bairro, categoria, status e período. Considerando {scope}.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
          <div className="flex gap-1" role="group" aria-label="Período rápido">
            {PRESETS.map((p) => {
              const active = p.days === null ? !from && !to : from === daysAgo(p.days) && !to;
              return (
                <Button key={p.label} size="sm" variant={active ? "default" : "outline"} onClick={() => setParams({ from: p.days === null ? null : daysAgo(p.days), to: null })}>
                  {p.label}
                </Button>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">De <Input type="date" value={from} max={to || undefined} onChange={(e) => setParams({ from: e.target.value || null })} className="w-36" aria-label="Data inicial" /></label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">até <Input type="date" value={to} min={from || undefined} onChange={(e) => setParams({ to: e.target.value || null })} className="w-36" aria-label="Data final" /></label>
          <div className="w-48">
            <Select value={category || ALL} onValueChange={(v) => setParams({ category: v === ALL ? null : v })}>
              <SelectTrigger aria-label="Categoria"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as categorias</SelectItem>
                {meta.categories.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}{c.active ? "" : " (inativa)"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Select value={status || ALL} onValueChange={(v) => setParams({ status: v === ALL ? null : v })}>
              <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os status</SelectItem>
                {meta.statuses.map((s) => <SelectItem key={s.slug} value={s.slug}>{s.name}{s.active ? "" : " (inativo)"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4", loading && "opacity-60 transition-opacity")}>
        {!t ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32" />) : (
          <>
            <Kpi title="Ocorrências" value={t.total} hint={`${t.rejected} recusadas`} icon={<Sigma />} />
            <Kpi title="Em aberto" value={t.open} hint="Aguardando verificação ou em andamento" icon={<Inbox />} />
            <Kpi title="Resolvidas" value={t.resolved} hint={t.total ? `${Math.round((t.resolved / t.total) * 100)}% do total` : "Nenhuma ainda"} icon={<CheckCircle2 />} />
            <Kpi title="Tempo de resolução" value={hours(t.avgResolutionHours)} hint={`Mediana: ${hours(t.medianResolutionHours)}`} icon={<Clock />} />
          </>
        )}
      </div>

      {t && t.noNeighborhood > 0 && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <MapPinOff className="size-4 shrink-0" />
          {t.noNeighborhood} {t.noNeighborhood === 1 ? "ocorrência está" : "ocorrências estão"} sem bairro. O bairro é preenchido automaticamente pelo local no mapa; o administrador pode reprocessar em{" "}
          <Link href="/configuracao" className="font-medium text-primary hover:underline">Configuração</Link>.
        </p>
      )}

      {data && (
        <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2", loading && "opacity-60 transition-opacity")}>
          <Panel title="Por bairro" onExport={() => download(`sinaly-por-bairro-${stamp}.csv`, tableToCsv(head("Bairro"), rowsCsv(data.byNeighborhood, (k) => k)))}>
            <RankTable rows={data.byNeighborhood} label={(k) => (k === NO_HOOD ? <span className="font-normal text-muted-foreground">{k}</span> : k)} />
          </Panel>
          <Panel title="Por categoria" onExport={() => download(`sinaly-por-categoria-${stamp}.csv`, tableToCsv(head("Categoria"), rowsCsv(data.byCategory, categoryName)))}>
            <RankTable rows={data.byCategory} label={categoryName} color={(k) => `var(--cat-${k}, var(--primary))`} />
          </Panel>
          <Panel title="Por status" onExport={() => download(`sinaly-por-status-${stamp}.csv`, tableToCsv(["Status", "Total"], data.byStatus.map((r) => [statusName(r.key), r.total])))}>
            {data.byStatus.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Sem dados no período.</p> : (
              <ul className="space-y-2.5">
                {data.byStatus.map((r) => (
                  <li key={r.key} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 text-sm">
                    <span className="truncate text-muted-foreground">{statusName(r.key)}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${(r.total / Math.max(1, ...data.byStatus.map((x) => x.total))) * 100}%`, background: statusColor(r.key) }} /></span>
                    <span className="text-right tabular-nums">{r.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Tempo até resolver" onExport={() => download(`sinaly-tempo-resolucao-${stamp}.csv`, tableToCsv(["Faixa", "Ocorrências"], [["Até 1 dia", data.resolutionBuckets.lt1d], ["1 a 3 dias", data.resolutionBuckets.d1to3], ["3 a 7 dias", data.resolutionBuckets.d3to7], ["Mais de 7 dias", data.resolutionBuckets.gt7d]]))}>
            {(() => {
              const b = data.resolutionBuckets;
              const rows = [["Até 1 dia", b.lt1d], ["1 a 3 dias", b.d1to3], ["3 a 7 dias", b.d3to7], ["Mais de 7 dias", b.gt7d]] as const;
              const max = Math.max(1, ...rows.map((r) => r[1]));
              return (
                <ul className="space-y-2.5">
                  {rows.map(([label, n]) => (
                    <li key={label} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${(n / max) * 100}%` }} /></span>
                      <span className="text-right tabular-nums">{n}</span>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </Panel>
          <Panel
            className="xl:col-span-2"
            title={data.grain === "day" ? "Registros por dia" : "Registros por mês"}
            onExport={() => download(`sinaly-por-periodo-${stamp}.csv`, tableToCsv([data.grain === "day" ? "Dia" : "Mês", "Registradas", "Resolvidas"], data.byPeriod.map((p) => [periodLabel(p.key), p.total, p.resolved])))}
          >
            {data.byPeriod.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Sem dados no período.</p> : (
              <div className="flex h-40 items-end gap-1 overflow-x-auto" role="img" aria-label="Ocorrências registradas por período">
                {(() => {
                  const max = Math.max(1, ...data.byPeriod.map((p) => p.total));
                  return data.byPeriod.map((p) => (
                    <div key={p.key} className="group flex h-full min-w-4 max-w-14 flex-1 flex-col justify-end" title={`${periodLabel(p.key)}: ${p.total} registradas, ${p.resolved} resolvidas`}>
                      <div className="min-h-px rounded-t-sm bg-primary/80 group-hover:bg-primary" style={{ height: `${(p.total / max) * 100}%` }} />
                      <span className="mt-1.5 text-center text-[10px] text-muted-foreground tabular-nums">{data.grain === "day" ? p.key.slice(8) : periodLabel(p.key)}</span>
                    </div>
                  ));
                })()}
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

export default function RelatoriosPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
