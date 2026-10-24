"use client";
import { Loader2, ShieldCheck } from "lucide-react";
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
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-6 text-center">
          <Logo />
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Entrar no painel</h1>
            <p className="text-sm text-muted-foreground">Acesso restrito a servidores da prefeitura.</p>
          </div>
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
            <Label htmlFor="totp">Código do autenticador</Label>
            <Input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={7} placeholder="6 dígitos" required className="font-mono tracking-[0.3em] placeholder:font-sans placeholder:tracking-normal" />
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
    </main>
  );
}
