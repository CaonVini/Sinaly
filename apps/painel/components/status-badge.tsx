import { STATUS_LABELS, type Status } from "@sinaly/shared";
import { cn } from "@/lib/utils";

export const statusColor = (s: Status) => `var(--st-${s})`;

/** Selo de status: fundo suave na cor do status e ponto cheio (mesma paleta dos alfinetes e da legenda). */
export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const c = statusColor(status);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap", className)}
      style={{ background: `color-mix(in oklab, ${c} 18%, var(--card))`, color: `color-mix(in oklab, ${c} 70%, var(--foreground))` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: c }} />
      {STATUS_LABELS[status]}
    </span>
  );
}
