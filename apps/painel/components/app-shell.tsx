"use client";
import { LayoutDashboard, ListChecks, LogOut, Table2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/visao-geral", label: "Visão geral", icon: LayoutDashboard },
  { href: "/ocorrencias", label: "Ocorrências", icon: ListChecks },
  { href: "/planilha", label: "Planilha", icon: Table2 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data: me } = useApi<{ name: string | null; email: string; role: string }>("me");

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b bg-card md:sticky md:top-0 md:h-dvh md:w-60 md:border-r md:border-b-0">
        <div className="flex h-14 items-center px-4 md:h-16 md:px-5">
          <Logo />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-1 md:flex-col md:pb-0">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden items-center gap-2 border-t p-3 md:flex">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me?.name ?? "Servidor"}</p>
            <p className="truncate text-xs text-muted-foreground">{me?.role === "gestor" ? "Gestor" : "Servidor"} · {me?.email}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair" title="Sair">
            <LogOut />
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
