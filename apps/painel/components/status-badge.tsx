import { STATUS_LABELS, type Status } from "@sinaly/shared";
import { cn } from "@/lib/utils";

export const statusColor = (s: Status) => `var(--st-${s})`;

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", className)}>
      <span className="size-1.5 rounded-full" style={{ background: statusColor(status) }} />
      {STATUS_LABELS[status]}
    </span>
  );
}
