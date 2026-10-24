"use client";
import { ALLOWED_TRANSITIONS, CATEGORIES, CATEGORY_LABELS, STATUS_LABELS, type Category, type Status } from "@sinaly/shared";
import { ExternalLink, ImageOff, Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { api, type AuditEntry, type Occurrence, useApi } from "@/lib/client";
import { cn, fmtDateTime } from "@/lib/utils";

const ACTION: Record<string, { label: string; variant: "default" | "outline" | "destructive" }> = {
  "nao_verificado>em_analise": { label: "Aprovar para análise", variant: "default" },
  "nao_verificado>recusado": { label: "Recusar", variant: "destructive" },
  "em_analise>em_atendimento": { label: "Iniciar atendimento", variant: "default" },
  "em_analise>resolvido": { label: "Marcar como resolvida", variant: "outline" },
  "em_analise>recusado": { label: "Recusar", variant: "destructive" },
  "em_atendimento>em_analise": { label: "Voltar para análise", variant: "outline" },
  "em_atendimento>resolvido": { label: "Marcar como resolvida", variant: "default" },
  "resolvido>em_atendimento": { label: "Reabrir", variant: "outline" },
  "recusado>nao_verificado": { label: "Desfazer recusa", variant: "outline" },
};

const FIELD: Record<string, string> = { status: "Status", category: "Categoria", description: "Descrição", location: "Localização", note: "Observação", photo: "Foto" };

function show(field: string, v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (field === "status") return STATUS_LABELS[v as Status] ?? String(v);
  if (field === "category") return CATEGORY_LABELS[v as Category] ?? String(v);
  if (field === "location" && typeof v === "object") {
    const p = v as { lat: number; lng: number };
    return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  }
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

export function OccurrenceSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby={undefined}>{id && <Detail key={id} id={id} onChanged={onChanged} />}</SheetContent>
    </Sheet>
  );
}

function Detail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const occ = useApi<Occurrence & { authorName?: string }>(`occurrences/${id}`);
  const audit = useApi<{ items: AuditEntry[] }>(`staff/occurrences/${id}/audit`);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoOk, setPhotoOk] = useState(true);
  const o = occ.data;

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`staff/occurrences/${id}`, { method: "PATCH", body });
      setNote("");
      setEditing(false);
      occ.reload();
      audit.reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setBusy(false);
    }
  }

  function transition(to: Status) {
    if (to === "recusado" && !note.trim()) {
      setError("Informe o motivo da recusa na observação.");
      return;
    }
    save({ status: to, ...(note.trim() ? { note: note.trim() } : {}) });
  }

  if (occ.error) return <p className="p-6 text-sm text-destructive">{occ.error}</p>;
  if (!o) return (
    <div className="space-y-4 p-6">
      <SheetTitle className="sr-only">Carregando</SheetTitle>
      <Skeleton className="h-6 w-1/2" /><Skeleton className="aspect-video w-full" /><Skeleton className="h-24 w-full" />
    </div>
  );

  const next = ALLOWED_TRANSITIONS[o.status];
  return (
    <>
      <header className="space-y-2 border-b p-5 pr-12">
        <SheetTitle>{CATEGORY_LABELS[o.category]}</SheetTitle>
        <SheetDescription className="text-xs text-muted-foreground">
          Registrada em {fmtDateTime(o.createdAt)}{o.authorName ? ` por ${o.authorName}` : ""}
        </SheetDescription>
        <StatusBadge status={o.status} />
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <div className="overflow-hidden rounded-lg border bg-muted">
          {o.photoUrl && photoOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/proxy/${o.photoUrl.replace(/^\//, "")}`} alt="Foto enviada pelo morador" className="aspect-video w-full object-cover" onError={() => setPhotoOk(false)} />
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center gap-2 text-sm text-muted-foreground"><ImageOff className="size-5" /> Sem foto</div>
          )}
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Descrição</Label>
            {!editing && <Button variant="ghost" size="sm" onClick={() => { setDesc(o.description); setEditing(true); }}><Pencil /> Editar</Button>}
          </div>
          {editing ? (
            <div className="space-y-2">
              <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
                <Button size="sm" disabled={busy || desc.trim().length < 10 || desc.trim() === o.description} onClick={() => save({ description: desc.trim() })}>Salvar</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{o.description}</p>
          )}
        </section>

        <section className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={o.category} onValueChange={(v) => save({ category: v })} disabled={busy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Local</Label>
            <a className="flex h-9 items-center gap-1.5 text-sm text-primary hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${o.lat}&mlon=${o.lng}#map=18/${o.lat}/${o.lng}`}>
              <span className="font-mono text-xs">{o.lat.toFixed(5)}, {o.lng.toFixed(5)}</span> <ExternalLink className="size-3.5" />
            </a>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border bg-muted/40 p-4">
          <Label htmlFor="note">Observação {next.includes("recusado") && <span className="font-normal text-muted-foreground">(obrigatória para recusar)</span>}</Label>
          <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Opcional. O morador recebe esta observação junto com a mudança de status." className="min-h-16 bg-card" />
          <div className="flex flex-wrap gap-2">
            {next.map((to) => {
              const a = ACTION[`${o.status}>${to}`] ?? { label: STATUS_LABELS[to], variant: "outline" as const };
              return <Button key={to} variant={a.variant} size="sm" disabled={busy} onClick={() => transition(to)}>{busy && <Loader2 className="animate-spin" />}{a.label}</Button>;
            })}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </section>

        <section className="space-y-3">
          <h4 className="text-sm font-medium">Histórico de alterações</h4>
          {audit.loading && !audit.data ? <Skeleton className="h-16 w-full" /> : (
            <ol className="relative space-y-4 border-l pl-5">
              {(audit.data?.items ?? []).slice().reverse().map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className={cn("absolute top-1.5 -left-[25px] size-2 rounded-full bg-border ring-4 ring-card", e === audit.data?.items.at(-1) && "bg-primary")} />
                  <p className="font-medium">{e.actorName ?? "Servidor"} <span className="font-normal text-muted-foreground">· {fmtDateTime(e.at)}</span></p>
                  <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                    {e.action === "create" || Object.keys(e.changes).length === 0 ? <li>Registro criado</li> : Object.entries(e.changes).map(([f, c]) => (
                      <li key={f}>{FIELD[f] ?? f}: {f === "description" || f === "note" ? show(f, c.to) : <>{show(f, c.from)} → <span className="text-foreground">{show(f, c.to)}</span></>}</li>
                    ))}
                  </ul>
                </li>
              ))}
              {audit.data && audit.data.items.length === 0 && <li className="text-sm text-muted-foreground">Nenhuma alteração ainda.</li>}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
