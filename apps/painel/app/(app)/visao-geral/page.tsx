"use client";
import { CATEGORY_LABELS, STATUSES, STATUS_LABELS, type Category, type Status } from "@sinaly/shared";
import { Clock, Inbox, Wrench, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { statusColor } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi, type Stats } from "@/lib/client";

function Kpi({ title, value, hint, icon, href }: { title: string; value: ReactNode; hint: string; icon: ReactNode; href?: string }) {
  const body = (
    <Card className={href ? "transition-colors hover:border-primary/50" : undefined}>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{title}</CardTitle>
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Bars({ rows, max }: { rows: { label: string; value: number; color?: string }[]; max: number }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full" style={{ width: `${max ? (r.value / max) * 100 : 0}%`, background: r.color ?? "var(--primary)" }} />
          </span>
          <span className="text-right tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function PerDay({ days }: { days: Stats["perDay"] }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  return (
    <div className="flex h-36 items-end gap-1.5" role="img" aria-label="Ocorrências criadas por dia nos últimos 14 dias">
      {days.map((d) => (
        <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.day.slice(8)}/${d.day.slice(5, 7)}: ${d.total}`}>
          <div className="min-h-px rounded-t-sm bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${(d.total / max) * 100}%` }} />
          <span className="mt-1.5 text-center text-[10px] text-muted-foreground tabular-nums">{d.day.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

export default function OverviewPage() {
  const { data, error, loading } = useApi<Stats>("staff/stats");
  const s = data?.byStatus ?? {};
  const n = (k: Status) => s[k] ?? 0;
  const total = STATUSES.reduce((a, k) => a + n(k), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
        <p className="text-sm text-muted-foreground">Situação das ocorrências registradas pelos moradores.</p>
      </header>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi title="Aguardando verificação" value={n("nao_verificado")} hint="Fila de triagem" icon={<Inbox />} href="/ocorrencias?status=nao_verificado" />
            <Kpi title="Em atendimento" value={n("em_atendimento") + n("em_analise")} hint={`${n("em_analise")} em análise · ${n("em_atendimento")} em atendimento`} icon={<Wrench />} href="/ocorrencias?status=em_atendimento" />
            <Kpi title="Resolvidas" value={n("resolvido")} hint={total ? `${Math.round((n("resolvido") / total) * 100)}% do total` : "Nenhuma ainda"} icon={<CheckCircle2 />} href="/ocorrencias?status=resolvido" />
            <Kpi
              title="Tempo médio de resolução"
              value={data.avgResolutionHours === null ? "—" : data.avgResolutionHours < 48 ? `${data.avgResolutionHours} h` : `${Math.round(data.avgResolutionHours / 24)} d`}
              hint="Do registro até resolver"
              icon={<Clock />}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Por status</CardTitle></CardHeader>
              <CardContent>
                <Bars max={Math.max(1, ...STATUSES.map(n))} rows={STATUSES.map((k) => ({ label: STATUS_LABELS[k], value: n(k), color: statusColor(k) }))} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Por categoria</CardTitle></CardHeader>
              <CardContent>
                <Bars
                  max={Math.max(1, ...Object.values(data.byCategory))}
                  rows={(Object.keys(CATEGORY_LABELS) as Category[]).map((k) => ({ label: CATEGORY_LABELS[k], value: data.byCategory[k] ?? 0 }))}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Registros nos últimos 14 dias</CardTitle></CardHeader>
            <CardContent><PerDay days={data.perDay} /></CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
