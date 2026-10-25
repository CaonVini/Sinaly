import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { iconFor } from "@/lib/icons";

const DROP = "M16 1C7.9 1 1.5 7.3 1.5 15.1c0 5.4 3.2 10 7.4 14.2L16 40l7.1-10.7c4.2-4.2 7.4-8.8 7.4-14.2C30.5 7.3 24.1 1 16 1z";
const HEX = /^#[0-9a-fA-F]{6}$/;

const iconCache = new Map<string, string>();
/** Ícone Lucide como <svg> aninhado (já escapado pelo React); cacheado por chave. */
function iconSvg(key: string): string {
  let s = iconCache.get(key);
  if (!s) {
    s = renderToStaticMarkup(createElement(iconFor(key), { x: 8, y: 6.5, width: 16, height: 16, color: "#fff", strokeWidth: 2.4 }));
    iconCache.set(key, s);
  }
  return s;
}

/**
 * Alfinete em gota: cor do status (hex vindo da configuração; valor inválido cai no cinza) e ícone da categoria.
 * "brand" usa a cor da marca. Âncora na ponta: 32x42, ponta em (16, 41).
 */
export function pinHtml(color: string | "brand", iconKey: string | null): string {
  const fill = color === "brand" ? "var(--primary)" : HEX.test(color) ? color : "#64748b";
  const icon = iconKey ? iconSvg(iconKey) : '<circle cx="16" cy="15" r="5" fill="#fff"/>';
  return `<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true"><path d="${DROP}" fill="${fill}" stroke="#fff" stroke-width="2"/>${icon}</svg>`;
}

export const PIN_SIZE: [number, number] = [32, 42];
export const PIN_ANCHOR: [number, number] = [16, 41];
