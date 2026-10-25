import { Building2, Bus, Car, Construction, Droplet, Flame, HardHat, Lightbulb, PawPrint, Shield, Signpost, Siren, Trash2, TreePine, Wrench, Zap, type LucideIcon } from "lucide-react";
import type { IconKey } from "@sinaly/shared";

/** Mesma lista branca da API (ICON_KEYS): o nome vem do banco, mas só chaves conhecidas viram componente. */
export const ICONS: Record<IconKey, LucideIcon> = {
  shield: Shield,
  wrench: Wrench,
  signpost: Signpost,
  droplet: Droplet,
  lightbulb: Lightbulb,
  trash: Trash2,
  tree: TreePine,
  bus: Bus,
  zap: Zap,
  building: Building2,
  construction: Construction,
  car: Car,
  flame: Flame,
  siren: Siren,
  paw: PawPrint,
  "hard-hat": HardHat,
};
export const iconFor = (key: string | undefined): LucideIcon => ICONS[key as IconKey] ?? Wrench;
