"use client";
import type { Category } from "@sinaly/shared";
import type { LucideProps } from "lucide-react";
import { iconFor } from "@/lib/icons";
import { useMeta } from "@/lib/meta";

/** Mesmo ícone do alfinete do mapa (configurável pela prefeitura). */
export function CategoryIcon({ category, ...props }: { category: Category } & LucideProps) {
  const { category: get } = useMeta();
  const Icon = iconFor(get(category)?.icon);
  return <Icon {...props} />;
}
