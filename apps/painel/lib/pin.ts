import type { Category, Status } from "@sinaly/shared";

/** Ícones das categorias (traços do conjunto Lucide, grade 24x24). */
const ICONS: Record<Category, string> = {
  seguranca: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  infraestrutura: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  sinalizacao: '<path d="M12 3v3M18.5 13h-13L2 9.5 5.5 6h13L22 9.5zM12 13v8"/>',
  saneamento: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  iluminacao: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>',
};

const DROP = "M16 1C7.9 1 1.5 7.3 1.5 15.1c0 5.4 3.2 10 7.4 14.2L16 40l7.1-10.7c4.2-4.2 7.4-8.8 7.4-14.2C30.5 7.3 24.1 1 16 1z";

/** Alfinete em gota: cor pelo status (ou a cor da marca), ícone pela categoria. Âncora na ponta: 32x42, ponta em (16, 41). */
export function pinHtml(color: Status | "brand", category: Category | null): string {
  const fill = color === "brand" ? "var(--primary)" : `var(--st-${color})`;
  const icon = category
    ? `<g transform="translate(8 6.5) scale(0.667)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[category]}</g>`
    : '<circle cx="16" cy="15" r="5" fill="#fff"/>';
  return `<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true"><path d="${DROP}" fill="${fill}" stroke="#fff" stroke-width="2"/>${icon}</svg>`;
}

export const PIN_SIZE: [number, number] = [32, 42];
export const PIN_ANCHOR: [number, number] = [16, 41];
