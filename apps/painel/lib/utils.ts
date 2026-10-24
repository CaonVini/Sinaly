import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** Título curto a partir da descrição: primeira frase, no máximo ~60 caracteres, sem cortar palavra. */
export function titleOf(description: string): string {
  const first = description.trim().split(/\n/)[0] ?? "";
  const sentence = first.match(/^.+?[.!?](\s|$)/)?.[0].trim() ?? first;
  const base = sentence.replace(/[.!?]+$/, "");
  if (base.length <= 60) return base;
  const cut = base.slice(0, 60);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 30))}…`;
}

const tz = "America/Sao_Paulo";
export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: tz }).format(new Date(iso));
export const fmtDate = (iso: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: tz }).format(new Date(iso));

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
