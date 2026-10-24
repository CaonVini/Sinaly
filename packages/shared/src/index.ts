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

export const digitsOnly = (v: string) => v.replace(/\D/g, "");

/** Valida CPF pelos dígitos verificadores (rejeita sequências repetidas). */
export function isValidCpf(raw: string): boolean {
  const cpf = digitsOnly(raw);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE",
  "PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
] as const;

export const PASSWORD_MIN_CITIZEN = 10;
export const PASSWORD_MIN_STAFF = 14;

const email = z.string().trim().toLowerCase().email().max(255);

export const registerSchema = z.object({
  email,
  password: z.string().min(PASSWORD_MIN_CITIZEN).max(128),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const staffLoginSchema = loginSchema.extend({
  totp: z.string().regex(/^\d{6}$/, "Código de 6 dígitos"),
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });

export const onboardingSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(100),
  phone: z
    .string()
    .transform(digitsOnly)
    .pipe(z.string().regex(/^[1-9]{2}9?\d{8}$/, "Telefone com DDD inválido")),
  cpf: z
    .string()
    .refine(isValidCpf, "CPF inválido")
    .transform(digitsOnly),
  address: z.object({
    cep: z.string().transform(digitsOnly).pipe(z.string().length(8, "CEP inválido")),
    street: z.string().trim().min(2).max(150),
    number: z.string().trim().min(1).max(10),
    complement: z.string().trim().max(60).optional(),
    neighborhood: z.string().trim().min(2).max(80),
    city: z.string().trim().min(2).max(80),
    state: z.enum(UFS),
  }),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;
