import type { Category } from "@sinaly/shared";
import { Droplet, Lightbulb, Shield, Signpost, Wrench, type LucideProps } from "lucide-react";

const ICONS = { seguranca: Shield, infraestrutura: Wrench, sinalizacao: Signpost, saneamento: Droplet, iluminacao: Lightbulb } as const;

/** Mesmos ícones do alfinete do mapa. */
export function CategoryIcon({ category, ...props }: { category: Category } & LucideProps) {
  const Icon = ICONS[category];
  return <Icon {...props} />;
}
