"use client";
import { ICON_KEYS, type CategoryMeta, type StatusMeta } from "@sinaly/shared";
import { ArrowDown, ArrowUp, Check, Loader2, Lock, MapPin, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, useApi } from "@/lib/client";
import { iconFor } from "@/lib/icons";
import { useMeta } from "@/lib/meta";
import { cn, fmtDateTime } from "@/lib/utils";

type Tab = "categories" | "statuses" | "bairro" | "historico";
const TABS: { id: Tab; label: string }[] = [
  { id: "categories", label: "Categorias" },
  { id: "statuses", label: "Status" },
  { id: "bairro", label: "Bairro automático" },
  { id: "historico", label: "Histórico" },
];
const PALETTE = ["#dc2626", "#f97316", "#e5a400", "#16a34a", "#0891b2", "#2563eb", "#9333ea", "#db2777", "#64748b"];
const KIND_LABEL: Record<string, string> = { initial: "Entrada", active: "Em andamento", resolved: "Resolvido", rejected: "Recusado" };

type Draft = { name: string; color: string; icon: string };

function ItemForm({ withIcon, initial, submitLabel, onSubmit, onCancel }: { withIcon: boolean; initial: Draft; submitLabel: string; onSubmit: (d: Draft) => Promise<void>; onCancel?: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = d.name.trim().length >= 2 && /^#[0-9a-fA-F]{6}$/.test(d.color);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...d, name: d.name.trim() });
      if (!onCancel) setD(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border bg-muted/40 p-4">
      <div className="grid gap-3">
        <div className="space-y-2">
          <Label htmlFor="cfg-name">Nome</Label>
          <Input id="cfg-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={40} placeholder={withIcon ? "Ex.: Coleta de lixo" : "Ex.: Aguardando peça"} className="bg-card" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cfg-color">Cor</Label>
          <div className="flex items-center gap-2">
            <input id="cfg-color" type="color" value={/^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color : "#2563eb"} onChange={(e) => setD({ ...d, color: e.target.value })} className="h-9 w-12 cursor-pointer rounded-md border bg-card p-1" aria-label="Escolher cor" />
            <div className="flex gap-1">
              {PALETTE.map((c) => (
                <button key={c} type="button" onClick={() => setD({ ...d, color: c })} className={cn("size-6 rounded-full ring-offset-2 ring-offset-card transition", d.color.toLowerCase() === c && "ring-2 ring-foreground")} style={{ background: c }} aria-label={`Cor ${c}`} />
              ))}
            </div>
          </div>
        </div>
      </div>
      {withIcon && (
        <div className="space-y-2">
          <Label>Ícone no mapa</Label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ícone">
            {ICON_KEYS.map((k) => {
              const Icon = iconFor(k);
              const on = d.icon === k;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} aria-label={k} onClick={() => setD({ ...d, icon: k })} className={cn("flex size-9 items-center justify-center rounded-md border bg-card transition-colors hover:bg-accent", on && "border-primary bg-accent text-primary")}>
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" size="sm" disabled={busy || !valid}>{busy ? <Loader2 className="animate-spin" /> : onCancel ? <Check /> : <Plus />} {submitLabel}</Button>
      </div>
    </form>
  );
}

type Item = (CategoryMeta | StatusMeta) & { icon?: string; kind?: string };

function ItemList({ kind, items, reload }: { kind: "categories" | "statuses"; items: Item[]; reload: () => Promise<void> }) {
  const isCat = kind === "categories";
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const noun = isCat ? "categoria" : "status";

  async function run(slug: string, fn: () => Promise<unknown>) {
    setBusySlug(slug);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusySlug(null);
    }
  }

  const move = (i: number, dir: -1 | 1) => {
    const slugs = items.map((x) => x.slug);
    const j = i + dir;
    if (j < 0 || j >= slugs.length) return;
    [slugs[i], slugs[j]] = [slugs[j]!, slugs[i]!];
    return run(items[i]!.slug, () => api(`staff/config/${kind}-order`, { method: "PUT", body: { slugs } }));
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-3">
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <ul className="divide-y rounded-xl border bg-card">
        {items.map((it, i) => {
          const Icon = isCat ? iconFor(it.icon) : null;
          const busy = busySlug === it.slug;
          if (editing === it.slug) {
            return (
              <li key={it.slug} className="p-3">
                <ItemForm
                  withIcon={isCat}
                  initial={{ name: it.name, color: it.color, icon: it.icon ?? "wrench" }}
                  submitLabel="Salvar"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (d) => {
                    await api(`staff/config/${kind}/${it.slug}`, { method: "PATCH", body: { name: d.name, color: d.color, ...(isCat ? { icon: d.icon } : {}) } });
                    setEditing(null);
                    await reload();
                  }}
                />
              </li>
            );
          }
          return (
            <li key={it.slug} className={cn("flex flex-wrap items-center gap-3 px-3 py-2.5", !it.active && "opacity-60")}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: it.color }} aria-hidden="true">
                {Icon ? <Icon className="size-4" /> : <span className="size-2.5 rounded-full bg-white" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {it.name}
                  {it.system && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground"><Lock className="size-3" /> Sistema</span>}
                  {!it.active && <span className="rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">Inativa</span>}
                </p>
                <p className="text-xs text-muted-foreground">{isCat ? it.slug : `${KIND_LABEL[it.kind ?? "active"]} · ${it.slug}`}</p>
              </div>
              <div className="flex items-center gap-0.5">
                <Button variant="ghost" size="icon" disabled={busySlug !== null || i === 0} onClick={() => move(i, -1)} aria-label={`Subir ${it.name}`}><ArrowUp /></Button>
                <Button variant="ghost" size="icon" disabled={busySlug !== null || i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Descer ${it.name}`}><ArrowDown /></Button>
                <Button variant="ghost" size="icon" disabled={busySlug !== null} onClick={() => setEditing(it.slug)} aria-label={`Editar ${it.name}`}><Pencil /></Button>
                {/* Status do sistema sustentam as regras (fluxo e regra dos 5 dias): não podem ser desativados. */}
                {!(it.system && !isCat) && (
                  <Button variant="outline" size="sm" disabled={busySlug !== null} onClick={() => run(it.slug, () => api(`staff/config/${kind}/${it.slug}`, { method: "PATCH", body: { active: !it.active } }))}>
                    {busy && <Loader2 className="animate-spin" />}{it.active ? "Desativar" : "Ativar"}
                  </Button>
                )}
                {!it.system && (
                  <Button variant="ghost" size="icon" disabled={busySlug !== null} aria-label={`Excluir ${it.name}`} className="text-destructive hover:text-destructive"
                    onClick={() => confirm(`Excluir ${noun} "${it.name}"? Só é possível se nunca foi usada.`) && run(it.slug, () => api(`staff/config/${kind}/${it.slug}`, { method: "DELETE" }))}>
                    <Trash2 />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      </div>

      <div className="xl:sticky xl:top-6">
        <h3 className="mb-2 text-sm font-medium">{isCat ? "Nova categoria" : "Novo status"}</h3>
        <ItemForm
          withIcon={isCat}
          initial={{ name: "", color: "#2563eb", icon: "wrench" }}
          submitLabel={`Adicionar ${noun}`}
          onSubmit={async (d) => {
            await api(`staff/config/${kind}`, { method: "POST", body: { name: d.name, color: d.color, ...(isCat ? { icon: d.icon } : {}) } });
            await reload();
          }}
        />
        {!isCat && <p className="mt-2 text-xs text-muted-foreground">Status novos entram como &ldquo;em andamento&rdquo;: aparecem no mapa público e o morador é avisado quando a ocorrência chega neles. Não verificado, Em análise, Em atendimento, Resolvido e Recusado são do sistema e só aceitam nome, cor e ordem.</p>}
      </div>
    </div>
  );
}

type AuditItem = { id: number; entity: string; entityKey: string; action: string; changes: Record<string, { from?: unknown; to?: unknown }>; actorName: string | null; at: string };
const ACTION: Record<string, string> = { create: "criou", update: "alterou", delete: "excluiu", reorder: "reordenou" };

function History() {
  const { data, error } = useApi<{ items: AuditItem[] }>("staff/config/audit");
  const { categoryName, statusName } = useMeta();
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-40 w-full" />;
  if (data.items.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma alteração de configuração ainda.</p>;
  const fmt = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "boolean" ? (v ? "sim" : "não") : Array.isArray(v) ? `${v.length} itens` : String(v));
  return (
    <ol className="divide-y rounded-xl border bg-card">
      {data.items.map((e) => (
        <li key={e.id} className="space-y-0.5 px-4 py-3 text-sm">
          <p>
            <span className="font-medium">{e.actorName ?? "Gestor"}</span> {ACTION[e.action] ?? e.action} {e.entity === "category" ? "a categoria" : "o status"}{" "}
            <span className="font-medium">{e.entityKey === "order" ? "(ordem)" : e.entity === "category" ? categoryName(e.entityKey) : statusName(e.entityKey)}</span>
            <span className="text-muted-foreground"> · {fmtDateTime(e.at)}</span>
          </p>
          {e.action !== "reorder" && (
            <ul className="text-xs text-muted-foreground">
              {Object.entries(e.changes).map(([k, c]) => (
                <li key={k}>{k}: {e.action === "create" ? fmt(c.to) : <>{fmt(c.from)} → {fmt(c.to)}</>}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

type GeoStatus = { enabled: boolean; missing: number; pending: number; filled: number; notFound: number; failed: number; lastError: string | null; lastErrorAt: string | null; lastFilledAt: string | null };

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "bad" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "bad" && "text-destructive")}>{value}</p>
    </div>
  );
}

function Backfill() {
  const st = useApi<GeoStatus>("staff/geocode/status");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const g = st.data;

  async function run() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api<{ queued: number; remaining: number }>("staff/geocode/backfill", { method: "POST" });
      setMsg(r.queued === 0 ? "Todas as ocorrências já têm bairro." : `${r.queued} ocorrências na fila (cerca de ${Math.max(1, Math.ceil((r.queued * 1.1) / 60))} min). ${r.remaining ? `Faltam mais ${r.remaining}: rode de novo depois.` : ""}`);
      st.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Card>
        <CardHeader><CardTitle>Preencher bairros automaticamente</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Toda ocorrência nova sem bairro é consultada pelo ponto no mapa (geocodificação reversa) e o bairro é preenchido em segundo plano. Cada preenchimento aparece no histórico da ocorrência como &ldquo;automático&rdquo;, e você pode corrigir manualmente.</p>
          <p className="text-muted-foreground">Só as coordenadas do problema saem do servidor para o serviço de mapas (OpenStreetMap/Nominatim); nenhum dado pessoal. O serviço público limita a 1 consulta por segundo, então o lote de ocorrências antigas leva alguns minutos. Ao reiniciar, o sistema também tenta preencher as que faltam.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={run} disabled={busy || g?.enabled === false}>{busy ? <Loader2 className="animate-spin" /> : <MapPin />} Preencher bairros que faltam</Button>
            <Button variant="ghost" size="sm" onClick={st.reload}>Atualizar números</Button>
            {msg && <span role="status" className="text-muted-foreground">{msg}</span>}
          </div>
          {error && <p className="text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Situação</h3>
        {!g ? <Skeleton className="h-40 w-full" /> : (
          <>
            <p className={cn("rounded-lg border px-3 py-2 text-sm", g.enabled ? "bg-card" : "border-destructive/30 bg-destructive/10 text-destructive")}>
              {g.enabled ? "Ligado." : "Desligado: defina GEOCODER_ENABLED=true no servidor."}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Sem bairro" value={g.missing} />
              <Stat label="Na fila agora" value={g.pending} />
              <Stat label="Preenchidas" value={g.filled} />
              <Stat label="Sem bairro no mapa" value={g.notFound} />
              <Stat label="Falhas do serviço" value={g.failed} tone={g.failed ? "bad" : undefined} />
            </div>
            {g.lastError && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Última falha{g.lastErrorAt ? ` (${fmtDateTime(g.lastErrorAt)})` : ""}: {g.lastError}. A ocorrência fica sem bairro e pode ser preenchida à mão ou reprocessada aqui.
              </p>
            )}
            <p className="text-xs text-muted-foreground">Contadores desde a última reinicialização da API.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function ConfiguracaoPage() {
  const { data: me } = useApi<{ role: string }>("me");
  const { meta, reload } = useMeta();
  const [tab, setTab] = useState<Tab>("categories");

  if (me && me.role !== "gestor") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Configuração</h1>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Lock className="size-4" /> Somente gestores podem alterar categorias e status.</p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configuração</h1>
        <p className="text-sm text-muted-foreground">Categorias e status que aparecem no mapa, nos filtros, na planilha e nos relatórios. Toda alteração fica registrada no histórico.</p>
      </header>
      <div className="flex flex-wrap gap-1 border-b" role="tablist" aria-label="Seções">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors", tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "categories" && <ItemList kind="categories" items={meta.categories as Item[]} reload={reload} />}
      {tab === "statuses" && <ItemList kind="statuses" items={meta.statuses as Item[]} reload={reload} />}
      {tab === "bairro" && <Backfill />}
      {tab === "historico" && <History />}
    </div>
  );
}
