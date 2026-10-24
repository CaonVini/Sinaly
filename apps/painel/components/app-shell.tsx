"use client";
import { LayoutDashboard, ListChecks, LogOut, Table2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useApi, type Stats } from "@/lib/client";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: LucideIcon; badge?: number };

const initials = (name?: string | null, email?: string) =>
  (name ?? email ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data: me } = useApi<{ name: string | null; email: string; role: string }>("me");
  const { data: stats } = useApi<Stats>("staff/stats");
  const pending = stats?.byStatus.nao_verificado ?? 0;

  const sections: { label: string; items: Item[] }[] = [
    { label: "Geral", items: [{ href: "/visao-geral", label: "Visão geral", icon: LayoutDashboard }] },
    {
      label: "Atendimento",
      items: [
        { href: "/ocorrencias", label: "Ocorrências", icon: ListChecks, badge: pending },
        { href: "/planilha", label: "Planilha", icon: Table2 },
      ],
    },
  ];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b bg-card md:sticky md:top-0 md:h-dvh md:w-64 md:border-r md:border-b-0">
        <div className="flex h-16 items-center justify-between px-5 md:h-20 md:items-end md:pb-4">
          <Link href="/visao-geral" aria-label="Sinaly, visão geral" className="flex flex-col">
            <Logo />
          </Link>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair" className="md:hidden">
            <LogOut />
          </Button>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-1 md:flex-col md:gap-6 md:overflow-visible md:px-4 md:pt-4 md:pb-0" aria-label="Principal">
          {sections.map((sec) => (
            <div key={sec.label} className="flex gap-1 md:flex-col md:gap-1">
              <p className="hidden px-3 pb-1 text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase md:block">{sec.label}</p>
              {sec.items.map(({ href, label, icon: Icon, badge }) => {
                const active = path.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors",
                      active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {active && <span className="absolute top-2 bottom-2 -left-4 hidden w-1 rounded-r-full bg-primary md:block" />}
                    <Icon className={cn("size-[1.125rem] shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                    <span className="flex-1">{label}</span>
                    {!!badge && (
                      <span className="rounded-full bg-primary px-1.5 text-[0.7rem] leading-5 font-semibold text-primary-foreground tabular-nums" title={`${badge} aguardando verificação`}>
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="hidden space-y-3 border-t p-4 md:block">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground" aria-hidden="true">
              {me ? initials(me.name, me.email) : ""}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm leading-tight font-semibold">{me?.name ?? "Servidor"}</p>
              <p className="text-xs text-muted-foreground">{me?.role === "gestor" ? "Gestor" : "Servidor"}</p>
            </div>
          </div>
          {me?.email && <p className="truncate text-xs text-muted-foreground" title={me.email}>{me.email}</p>}
          <Button variant="outline" size="sm" className="w-full" onClick={logout}>
            <LogOut /> Sair
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
