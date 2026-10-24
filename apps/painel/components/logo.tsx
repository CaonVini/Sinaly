import { cn } from "@/lib/utils";

/** Marca Sinaly: um ponto no mapa emitindo sinal. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <circle cx="16" cy="19" r="3.2" fill="#fff" />
      <path d="M10.2 13.6a8.2 8.2 0 0 1 11.6 0M6.8 10.2a13 13 0 0 1 18.4 0" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".92" />
    </svg>
  );
}

export function Logo({ className, onDark }: { className?: string; onDark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className={cn("text-lg font-semibold tracking-tight", onDark && "text-white")}>Sinaly</span>
    </span>
  );
}
