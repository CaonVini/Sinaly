import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { MetaProvider } from "@/lib/meta";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <MetaProvider>
      <AppShell>{children}</AppShell>
    </MetaProvider>
  );
}
