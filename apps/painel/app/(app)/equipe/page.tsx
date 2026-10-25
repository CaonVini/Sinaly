"use client";
import { ROLE_LABELS, STAFF_ROLES } from "@sinaly/shared";
import { Check, Copy, KeyRound, Loader2, Lock, Plus, ShieldCheck } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, useApi } from "@/lib/client";
import { cn, fmtDateTime } from "@/lib/utils";

type Member = { id: string; email: string; name: string | null; role: string; isActive: boolean; lastLoginAt: string | null; createdAt: string; locked: boolean };
type Credentials = { password: string; totpSecret: string; otpauthUri: string };
type AccessRow = { id: number; action: string; actorName: string | null; actorEmail: string; actorRole: string; subjectType: string | null; subjectId: string | null; details: Record<string, unknown> | null; ip: string | null; at: string };
type Tab = "contas" | "acessos";

const roleLabel = (r: string) => (ROLE_LABELS as Record<string, string>)[r] ?? r;
const selectCls = "h-10 w-full rounded-lg border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

const ACTIONS: Record<string, string> = {
  "occurrence.view": "Abriu uma ocorrência",
  "occurrence.photo": "Viu uma foto",
  "occurrence.list": "Listou ocorrências",
  "occurrence.export": "Exportou a planilha",
  "occurrence.audit_view": "Viu o histórico de uma ocorrência",
  "activity.view": "Viu a atividade recente",
  "staff.list": "Listou a equipe",
  "staff.create": "Criou uma conta",
  "staff.update": "Alterou uma conta",
  "staff.reset": "Redefiniu credenciais",
  "access_audit.view": "Consultou esta trilha",
};

/** Pede o código TOTP do próprio admin antes de uma ação sensível (a API valida e impede reuso do código). */
function StepUp({ title, text, busy, error, onConfirm, onClose, children }: { title: string; text: string; busy: boolean; error: string | null; onConfirm: (totp: string) => void; onClose: () => void; children?: ReactNode }) {
  const [totp, setTotp] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            onConfirm(totp);
          }}
        >
          <div className="flex items-center gap-2"><Lock className="size-4 text-primary" /><DialogTitle>{title}</DialogTitle></div>
          <DialogDescription>{text}</DialogDescription>
          {children}
          <div className="space-y-1.5">
            <Label htmlFor="totp">Seu código do autenticador (6 dígitos)</Label>
            <Input id="totp" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} autoFocus />
            <p className="text-xs text-muted-foreground">Cada código vale uma vez. Se acabou de usar um, espere o próximo.</p>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy || totp.length !== 6}>{busy && <Loader2 className="animate-spin" />} Confirmar</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 rounded-lg border bg-muted px-3 py-2 text-sm break-all select-all">{value}</code>
        <Button type="button" variant="outline" size="icon" aria-label={`Copiar ${label}`} onClick={() => navigator.clipboard?.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => null)}>
          {ok ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

/** Credenciais aparecem uma única vez: a API não guarda a senha em claro nem devolve o segredo de novo. */
function CredentialsDialog({ email, creds, onClose }: { email: string; creds: Credentials; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <div className="flex items-center gap-2"><KeyRound className="size-4 text-primary" /><DialogTitle>Credenciais de {email}</DialogTitle></div>
        <DialogDescription>Copie agora e entregue por um canal seguro. Esta é a única vez que a senha e o segredo do autenticador aparecem; depois só dá para redefinir.</DialogDescription>
        <CopyField label="Senha provisória" value={creds.password} />
        <CopyField label="Segredo do autenticador (TOTP)" value={creds.totpSecret} />
        <CopyField label="Link otpauth (para gerar o QR)" value={creds.otpauthUri} />
        <div className="flex justify-end"><Button onClick={onClose}>Já copiei</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function Contas({ meId }: { meId: string | undefined }) {
  const { data, error, loading, reload } = useApi<{ items: Member[] }>("admin/staff");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "servidor" });
  const [pending, setPending] = useState<{ title: string; text: string; run: (totp: string) => Promise<Credentials | void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState<{ email: string; creds: Credentials } | null>(null);

  async function confirm(totp: string) {
    if (!pending) return;
    setBusy(true);
    setErr(null);
    try {
      const out = await pending.run(totp);
      setPending(null);
      setCreating(false);
      reload();
      if (out) setShown({ email: (out as Credentials & { email?: string }).email ?? "", creds: out });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Falha na operação");
    } finally {
      setBusy(false);
    }
  }
  const ask = (title: string, text: string, run: (totp: string) => Promise<Credentials | void>) => {
    setErr(null);
    setPending({ title, text, run });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Só administradores veem e gerenciam esta área. Toda ação pede o seu código do autenticador e fica na trilha de acessos.</p>
        <Button onClick={() => { setForm({ email: "", name: "", role: "servidor" }); setCreating(true); }}><Plus /> Nova conta</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loading && !data ? <Skeleton className="h-40 w-full" /> : (
        <Card>
          <CardContent className="divide-y p-0">
            {data?.items.map((m) => {
              const self = m.id === meId;
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{m.name ?? m.email} {self && <span className="font-normal text-muted-foreground">(você)</span>}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.email} · último acesso {m.lastLoginAt ? fmtDateTime(m.lastLoginAt) : "nunca"}</p>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", m.role === "admin" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>{roleLabel(m.role)}</span>
                  {!m.isActive && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Inativa</span>}
                  {m.locked && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">Bloqueada</span>}
                  {!self && (
                    <div className="flex flex-wrap items-center gap-2">
                      <select aria-label={`Cargo de ${m.email}`} className={cn(selectCls, "h-9 w-36")} value={m.role} onChange={(e) => {
                        const role = e.target.value;
                        ask("Alterar cargo", `${m.email}: ${roleLabel(m.role)} → ${roleLabel(role)}. As sessões dessa pessoa serão encerradas.`, async (totp) => { await api(`admin/staff/${m.id}`, { method: "PATCH", body: { role, totp } }); });
                      }}>
                        {STAFF_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                      <Button variant="outline" size="sm" onClick={() => ask(m.isActive ? "Desativar conta" : "Reativar conta", `${m.email} ${m.isActive ? "perde o acesso e as sessões são encerradas." : "volta a poder entrar."}`, async (totp) => { await api(`admin/staff/${m.id}`, { method: "PATCH", body: { active: !m.isActive, totp } }); })}>
                        {m.isActive ? "Desativar" : "Reativar"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => ask("Redefinir credenciais", `Gera nova senha e novo autenticador para ${m.email}. A senha e o TOTP atuais deixam de valer.`, async (totp) => ({ ...(await api<{ credentials: Credentials }>(`admin/staff/${m.id}/reset`, { method: "POST", body: { totp } })).credentials, email: m.email }) as Credentials)}>
                        Redefinir
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Dialog open={creating && !pending} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              ask("Criar conta", `Nova conta de ${roleLabel(form.role)} para ${form.email}. A senha e o autenticador serão mostrados uma única vez.`, async (totp) => ({ ...(await api<{ credentials: Credentials }>("admin/staff", { method: "POST", body: { ...form, totp } })).credentials, email: form.email }) as Credentials);
            }}
          >
            <DialogTitle>Nova conta de funcionário</DialogTitle>
            <DialogDescription>Não existe cadastro público. A pessoa entra com e-mail, senha e código do autenticador.</DialogDescription>
            <div className="space-y-1.5"><Label htmlFor="n-name">Nome</Label><Input id="n-name" required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="n-email">E-mail</Label><Input id="n-email" type="email" required maxLength={255} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label htmlFor="n-role">Cargo</Label>
              <select id="n-role" className={selectCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {STAFF_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Servidor: triagem, planilha e relatórios. Gestor: também configura categorias e status. Administrador: também gerencia a equipe e vê a trilha de acessos.</p>
            </div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancelar</Button><Button type="submit">Continuar</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      {pending && <StepUp title={pending.title} text={pending.text} busy={busy} error={err} onConfirm={confirm} onClose={() => { setPending(null); reload(); }} />}
      {shown && <CredentialsDialog email={shown.email} creds={shown.creds} onClose={() => setShown(null)} />}
    </div>
  );
}

function Acessos() {
  const [action, setAction] = useState("");
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(more: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ limit: "50" });
      if (action) qs.set("action", action);
      if (more && cursor) qs.set("cursor", cursor);
      const p = await api<{ items: AccessRow[]; nextCursor: string | null }>(`admin/access-audit?${qs}`);
      setRows((cur) => (more ? [...cur, ...p.items] : p.items));
      setCursor(p.nextCursor);
      setLoaded(action);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Quem acessou ou alterou dados pessoais, quando e de onde. O registro é imutável. Abrir esta tela também fica registrado.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="a-act">Tipo de acesso</Label>
          <select id="a-act" className={cn(selectCls, "w-64")} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <Button onClick={() => load(false)} disabled={busy}>{busy && <Loader2 className="animate-spin" />} {loaded === null ? "Consultar" : "Atualizar"}</Button>
      </div>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      {loaded !== null && (
        <Card>
          <CardContent className="divide-y p-0">
            {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhum registro.</p>}
            {rows.map((r) => (
              <div key={r.id} className="space-y-0.5 p-4 text-sm">
                <p><span className="font-semibold">{r.actorName ?? r.actorEmail}</span> <span className="text-muted-foreground">({roleLabel(r.actorRole)})</span> · {ACTIONS[r.action] ?? r.action}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtDateTime(r.at)}{r.ip ? ` · IP ${r.ip}` : ""}{r.subjectId ? ` · ${r.subjectType} ${r.subjectId.slice(0, 8)}` : ""}
                  {r.details && Object.keys(r.details).length > 0 ? ` · ${JSON.stringify(r.details).slice(0, 160)}` : ""}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {cursor && <Button variant="outline" onClick={() => load(true)} disabled={busy}>Carregar mais</Button>}
    </div>
  );
}

export default function EquipePage() {
  const { data: me } = useApi<{ id: string; role: string }>("me");
  const [tab, setTab] = useState<Tab>("contas");

  if (me && me.role !== "admin") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Equipe</h1>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Lock className="size-4" /> Somente administradores.</p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><ShieldCheck className="size-6 text-primary" /> Equipe</h1>
        <p className="text-sm text-muted-foreground">Contas de funcionários, cargos e a trilha de acessos a dados pessoais (LGPD).</p>
      </header>
      <div className="flex flex-wrap gap-1 border-b" role="tablist" aria-label="Seções">
        {([["contas", "Contas"], ["acessos", "Acessos (LGPD)"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors", tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>
      {tab === "contas" ? <Contas meId={me?.id} /> : <Acessos />}
    </div>
  );
}
