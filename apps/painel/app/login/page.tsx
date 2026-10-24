"use client";
import { Loader2, MapPin, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: String(f.get("email")).trim().toLowerCase(), password: f.get("password"), totp: String(f.get("totp")).replace(/\s/g, "") }),
      });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Não foi possível entrar");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Sem conexão com o servidor");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-deep p-12 text-white lg:flex">
        <svg className="absolute inset-0 size-full opacity-[0.14]" aria-hidden="true">
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        <Logo onDark className="relative" />
        <div className="relative max-w-md space-y-4">
          <p className="text-3xl leading-tight font-semibold tracking-tight text-balance">Cada problema da cidade, no mapa e sob responsabilidade de alguém.</p>
          <p className="text-sm leading-relaxed text-white/70">Verifique, priorize e acompanhe as ocorrências registradas pelos moradores. Cada alteração fica registrada e o cidadão é avisado.</p>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-white/60">
          <MapPin className="size-3.5" /> Painel da prefeitura
        </p>
      </aside>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <Logo className="lg:hidden" />
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Entrar no painel</h1>
            <p className="text-sm text-muted-foreground">Acesso restrito a servidores. Use seu e-mail institucional e o código do aplicativo autenticador.</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" autoComplete="username" required maxLength={254} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="totp">Código de 6 dígitos</Label>
              <Input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={7} required className="font-mono tracking-[0.3em]" />
            </div>
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Entrar
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
