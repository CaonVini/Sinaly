import { z } from "zod";

export const CATEGORIES = [
  "seguranca",
  "infraestrutura",
  "sinalizacao",
  "saneamento",
  "iluminacao",
] as const;
export const categorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof categorySchema>;

export const ROLES = ["cidadao", "servidor", "gestor"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

// Fluxo: aguardando_aprovacao -> (recusado | em_analise -> em_atendimento -> resolvido)
export const STATUSES = [
  "aguardando_aprovacao",
  "em_analise",
  "em_atendimento",
  "resolvido",
  "recusado",
] as const;
export const statusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof statusSchema>;

export const PUBLIC_STATUSES: readonly Status[] = [
  "em_analise",
  "em_atendimento",
  "resolvido",
];

export const createOccurrenceSchema = z.object({
  category: categorySchema,
  description: z.string().trim().min(10).max(1000),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  photoKey: z.string().max(255).optional(),
});
export type CreateOccurrenceInput = z.infer<typeof createOccurrenceSchema>;

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(128),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;
