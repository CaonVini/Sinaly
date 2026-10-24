import { CATEGORY_LABELS, SOURCE_LABELS, STATUS_LABELS } from "@sinaly/shared";
import type { Occurrence } from "@/lib/client";

const tz = "America/Sao_Paulo";
const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: tz }).format(new Date(iso)).replace(",", "") : "";

/**
 * Células que o Excel interpretaria como fórmula (=, +, -, @, tab, CR) ganham um apóstrofo à frente:
 * evita "CSV injection" vindo de texto digitado por moradores.
 */
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const cell = (v: unknown) => {
  const s = safe(String(v ?? "")).replace(/\r?\n/g, " ");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const phone = (d?: string | null) =>
  !d ? "" : d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;

const COLUMNS: [string, (o: Occurrence) => unknown][] = [
  ["Protocolo", (o) => o.id.slice(0, 8).toUpperCase()],
  ["Registrada em", (o) => fmt(o.createdAt)],
  ["Atualizada em", (o) => fmt(o.updatedAt)],
  ["Resolvida em", (o) => fmt(o.resolvedAt)],
  ["Categoria", (o) => CATEGORY_LABELS[o.category]],
  ["Status", (o) => STATUS_LABELS[o.status]],
  ["Descrição", (o) => o.description],
  ["Latitude", (o) => String(o.lat).replace(".", ",")],
  ["Longitude", (o) => String(o.lng).replace(".", ",")],
  ["Origem", (o) => (o.source ? SOURCE_LABELS[o.source] : "")],
  ["Registrada por", (o) => o.authorName ?? ""],
  ["Contato (nome)", (o) => o.contact?.name ?? ""],
  ["Contato (telefone)", (o) => phone(o.contact?.phone)],
  ["Tem foto", (o) => (o.photoUrl ? "Sim" : "Não")],
];

/** CSV para o Excel brasileiro: separador ";", UTF-8 com BOM. */
export function toCsv(rows: Occurrence[]): string {
  const head = COLUMNS.map(([h]) => h).join(";");
  const body = rows.map((o) => COLUMNS.map(([, f]) => cell(f(o))).join(";"));
  return "﻿" + [head, ...body].join("\r\n");
}

export function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
