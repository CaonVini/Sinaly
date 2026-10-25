"use client";
import type { Status } from "@sinaly/shared";
import { useMeta } from "@/lib/meta";
import { cn } from "@/lib/utils";

/** Cor do status: variável CSS definida pelo MetaProvider a partir da configuração da prefeitura. */
export const statusColor = (s: Status) => `var(--st-${s}, var(--muted-foreground))`;

/** Selo de status: fundo suave na cor do status e ponto cheio (mesma paleta dos alfinetes e da legenda). */
export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const { statusName } = useMeta();
  const c = statusColor(status);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap", className)}
      style={{ background: `color-mix(in oklab, ${c} 18%, var(--card))`, color: `color-mix(in oklab, ${c} 70%, var(--foreground))` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: c }} />
      {statusName(status)}
    </span>
  );
}
