"use client";
import { AlertTriangle, CheckCircle2, Clock, Inbox, Wrench } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { statusColor } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeta } from "@/lib/meta";
import { useApi, type Activity, type Occurrence, type Stats } from "@/lib/client";
import { cn, fmtDateTime, timeAgo } from "@/lib/utils";

const OccurrenceMap = dynamic(() => import("@/components/occurrence-map").then((m) => m.OccurrenceMap), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

function Kpi({ title, value, hint, icon, href, tone }: { title: string; value: ReactNode; hint: string; icon: ReactNode; href?: string; tone?: "warn" }) {
  const body = (
    <Card className={cn("h-full", href && "transition-colors hover:border-primary/50", tone === "warn" && "border-[color:var(--st-nao_verificado)]/60")}>
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
  return href ? <Link href={href}>{body}</Link> : body;
}

function Bars({ rows, max }: { rows: { label: string; value: number; color?: string }[]; max: number }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-3 text-sm">
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
    <div className="flex h-32 items-end gap-1" role="img" aria-label="Ocorrências criadas por dia nos últimos 14 dias">
      {days.map((d) => (
        <div key={d.day} className="group flex h-full flex-1 flex-col justify-end" title={`${d.day.slice(8)}/${d.day.slice(5, 7)}: ${d.total}`}>
          <div className="min-h-px rounded-t-sm bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${(d.total / max) * 100}%` }} />
          <span className="mt-1.5 text-center text-[10px] text-muted-foreground tabular-nums">{d.day.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("flex min-h-0 flex-col", className)}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto">{children}</CardContent>
    </Card>
  );
}

/** Texto curto do que aconteceu, a partir do registro de auditoria. */
function describe(a: Activity, statusName: (s: string) => string): string {
  const s = a.changes.status;
  if (a.action === "create") return a.changes.source?.to === "prefeitura" ? "registrou pela prefeitura" : "registrou";
  if (s) return `${s.from ? statusName(String(s.from)) : "—"} → ${statusName(String(s.to))}`;
  if (a.action === "geocode_auto") return "preencheu o bairro automaticamente";
  if (a.action === "photo_replace") return "trocou a foto";
  return `editou ${Object.keys(a.changes).filter((k) => k !== "note").map((k) => ({ category: "categoria", description: "descrição", location: "local" })[k] ?? k).join(", ")}`;
}

export default function OverviewPage() {
  const router = useRouter();
  const stats = useApi<Stats>("staff/stats");
  const queue = useApi<{ items: Occurrence[] }>("staff/occurrences?status=nao_verificado&limit=8");
  const map = useApi<{ items: Occurrence[] }>("staff/occurrences?limit=100");
  const activity = useApi<{ items: Activity[] }>("staff/activity?limit=12");

  const data = stats.data;
  const { meta, statusName, categoryName } = useMeta();
  const s = data?.byStatus ?? {};
  const n = (k: string) => s[k] ?? 0;
  const total = Object.values(s).reduce((a, v) => a + v, 0);
  // Os cartões somam por TIPO de status, então valem também para os status criados pela prefeitura.
  const ofKind = (kind: string) => meta.statuses.filter((x) => x.kind === kind);
  const sumKind = (kind: string) => ofKind(kind).reduce((a, x) => a + n(x.slug), 0);
  const active = ofKind("active");
  const visibleStatuses = meta.statuses.filter((x) => x.active || n(x.slug) > 0);
  const open = (id: string) => router.push(`/ocorrencias?id=${id}`);

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4 md:p-6 lock:h-dvh lock:overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
          <p className="text-sm text-muted-foreground">{total} ocorrências no total · situação em tempo real.</p>
        </div>
        {data && data.unverifiedOver24h > 0 && (
          <Link
            href="/ocorrencias?status=nao_verificado"
            className="flex items-center gap-2 rounded-md border border-[color:var(--st-nao_verificado)]/60 bg-[color:var(--st-nao_verificado)]/10 px-3 py-1.5 text-sm font-medium"
          >
            <AlertTriangle className="size-4 text-[color:var(--st-nao_verificado)]" />
            {data.unverifiedOver24h} {data.unverifiedOver24h === 1 ? "ocorrência aguarda" : "ocorrências aguardam"} verificação há mais de 24 h
          </Link>
        )}
      </header>

      {stats.error && <p role="alert" className="text-sm text-destructive">{stats.error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!data ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32" />) : (
          <>
            <Kpi title="Aguardando verificação" value={sumKind("initial")} hint="Fila de triagem" icon={<Inbox />} href="/ocorrencias?status=nao_verificado" tone={data.unverifiedOver24h ? "warn" : undefined} />
            <Kpi title="Em andamento" value={sumKind("active")} hint={active.filter((x) => n(x.slug) > 0).map((x) => `${n(x.slug)} ${x.name.toLowerCase()}`).join(" · ") || "Nenhuma em andamento"} icon={<Wrench />} href={`/ocorrencias?status=${active.find((x) => !x.isEntry)?.slug ?? "em_atendimento"}`} />
            <Kpi title="Resolvidas" value={sumKind("resolved")} hint={total ? `${Math.round((sumKind("resolved") / total) * 100)}% do total` : "Nenhuma ainda"} icon={<CheckCircle2 />} href="/ocorrencias?status=resolvido" />
            <Kpi
              title="Tempo médio de resolução"
              value={data.avgResolutionHours === null ? "—" : data.avgResolutionHours < 48 ? `${data.avgResolutionHours} h` : `${Math.round(data.avgResolutionHours / 24)} d`}
              hint="Do registro até resolver"
              icon={<Clock />}
            />
          </>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,1fr)]">
        <div className="grid min-h-0 content-start gap-4 lock:content-stretch lock:grid-rows-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card className="flex h-80 min-h-0 flex-col overflow-hidden lock:h-auto">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle>Mapa das ocorrências</CardTitle>
              <Link href="/ocorrencias" className="text-xs font-medium text-primary hover:underline">Abrir mapa completo</Link>
            </CardHeader>
            <div className="min-h-0 flex-1 border-t">
              <OccurrenceMap items={map.data?.items ?? []} selectedId={null} onSelect={open} fitKey="overview" />
            </div>
          </Card>
          <div className="grid gap-4 md:grid-cols-3">
            <Panel title="Por status">
              <Bars max={Math.max(1, ...visibleStatuses.map((x) => n(x.slug)))} rows={visibleStatuses.map((x) => ({ label: x.name, value: n(x.slug), color: statusColor(x.slug) }))} />
            </Panel>
            <Panel title="Por categoria">
              <Bars max={Math.max(1, ...Object.values(data?.byCategory ?? {}))} rows={meta.categories.filter((c) => c.active || (data?.byCategory[c.slug] ?? 0) > 0).map((c) => ({ label: c.name, value: data?.byCategory[c.slug] ?? 0 }))} />
            </Panel>
            <Panel title="Registros nos últimos 14 dias">{data && <PerDay days={data.perDay} />}</Panel>
          </div>
        </div>

        <div className="grid min-h-0 gap-4 lock:grid-rows-2">
          <Panel title="Aguardando verificação" action={<Link href="/ocorrencias?status=nao_verificado" className="text-xs font-medium text-primary hover:underline">Ver fila</Link>} className="max-h-96 lock:max-h-none">
            {queue.data && queue.data.items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma ocorrência na fila.</p>}
            <ul className="-mx-2 divide-y">
              {(queue.data?.items ?? []).map((o) => (
                <li key={o.id}>
                  <button onClick={() => open(o.id)} className="flex w-full items-start gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-accent/60">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: statusColor(o.status) }} />
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between gap-2 text-sm font-medium">{categoryName(o.category)}<span className="text-xs font-normal text-muted-foreground">{timeAgo(o.createdAt)}</span></span>
                      <span className="line-clamp-1 text-sm text-muted-foreground">{o.description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Atividade recente" className="max-h-96 lock:max-h-none">
            {activity.data && activity.data.items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma atividade ainda.</p>}
            <ul className="-mx-2 divide-y">
              {(activity.data?.items ?? []).map((a) => (
                <li key={a.id}>
                  <button onClick={() => open(a.occurrenceId)} className="flex w-full flex-col gap-0.5 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-accent/60" title={fmtDateTime(a.at)}>
                    <span className="flex justify-between gap-2 text-sm"><span><span className="font-medium">{a.actorName ?? "Servidor"}</span> <span className="text-muted-foreground">{describe(a, statusName)}</span></span><span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.at)}</span></span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{categoryName(a.category)} · {a.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
