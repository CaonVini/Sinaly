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

// Fluxo: nao_verificado -> (recusado | em_analise -> em_atendimento -> resolvido)
export const STATUSES = [
  "nao_verificado",
  "em_analise",
  "em_atendimento",
  "resolvido",
  "recusado",
] as const;
export const statusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof statusSchema>;

export const STATUS_LABELS: Record<Status, string> = {
  nao_verificado: "Não verificado",
  em_analise: "Em análise",
  em_atendimento: "Em atendimento",
  resolvido: "Resolvido",
  recusado: "Recusado",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  seguranca: "Segurança",
  infraestrutura: "Infraestrutura",
  sinalizacao: "Sinalização",
  saneamento: "Saneamento",
  iluminacao: "Iluminação",
};

/** Status que qualquer pessoa pode ver no mapa público. */
export const PUBLIC_STATUSES: readonly Status[] = ["em_analise", "em_atendimento", "resolvido"];

/** Depois de resolvida, a ocorrência some do mapa após N dias (volta com o filtro "resolvidos"). */
export const RESOLVED_VISIBLE_DAYS = 5;

/** Transições que a prefeitura pode fazer. Qualquer outra é recusada pela API. */
export const ALLOWED_TRANSITIONS: Record<Status, readonly Status[]> = {
  nao_verificado: ["em_analise", "recusado"],
  em_analise: ["em_atendimento", "resolvido", "recusado"],
  em_atendimento: ["em_analise", "resolvido"],
  resolvido: ["em_atendimento"], // reabrir
  recusado: ["nao_verificado"], // reconsiderar
};

/** Remove caracteres de controle (exceto quebra de linha) e espaços nas pontas. */
export const cleanText = (v: string) =>
  v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();

const text = (min: number, max: number) => z.string().transform(cleanText).pipe(z.string().min(min).max(max));
const numberField = z
  .string()
  .trim()
  .min(1)
  .transform(Number)
  .pipe(z.number().finite());
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/** Campos de texto do formulário multipart de nova ocorrência (a foto vem como arquivo). */
export const createOccurrenceFieldsSchema = z.object({
  category: categorySchema,
  description: text(10, 1000),
  lat: numberField.pipe(latitude),
  lng: numberField.pipe(longitude),
});
export type CreateOccurrenceFields = z.infer<typeof createOccurrenceFieldsSchema>;

/** Estados em que a prefeitura pode registrar uma ocorrência (ex.: ligação por telefone). */
export const STAFF_CREATE_STATUSES = ["nao_verificado", "em_analise", "em_atendimento"] as const;
export const SOURCES = ["app", "prefeitura"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABELS: Record<Source, string> = { app: "Aplicativo", prefeitura: "Prefeitura" };

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Cadastro manual pela prefeitura (multipart; a foto é opcional). Contato de quem ligou é opcional. */
export const staffCreateFieldsSchema = createOccurrenceFieldsSchema.extend({
  status: z.enum(STAFF_CREATE_STATUSES).default("em_analise"),
  // Campo vazio do formulário vale como "não informado".
  reporterName: z.preprocess(blankToUndefined, text(2, 120).optional()),
  reporterPhone: z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((v) => v.replace(/\D/g, ""))
      .pipe(z.string().regex(/^\d{10,11}$/, "Telefone inválido (DDD + número)"))
      .optional(),
  ),
});
export type StaffCreateFields = z.infer<typeof staffCreateFieldsSchema>;

/** Edição pela prefeitura. Campos desconhecidos (ex.: authorId) são rejeitados. */
export const staffUpdateSchema = z
  .object({
    category: categorySchema.optional(),
    description: text(10, 1000).optional(),
    lat: latitude.optional(),
    lng: longitude.optional(),
    status: statusSchema.optional(),
    note: text(1, 500).optional(),
  })
  .strict()
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), "Informe lat e lng juntos")
  .refine(
    (v) => v.category !== undefined || v.description !== undefined || v.lat !== undefined || v.status !== undefined,
    "Nada para alterar",
  );
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

const bbox = z
  .string()
  .transform((v) => v.split(",").map(Number))
  .pipe(z.tuple([longitude, latitude, longitude, latitude]))
  .refine(([minLng, minLat, maxLng, maxLat]) => minLng < maxLng && minLat < maxLat, "bbox inválido")
  .transform(([minLng, minLat, maxLng, maxLat]) => ({ minLng, minLat, maxLng, maxLat }));
const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");
const limit = (max: number, def: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max)).default(String(def));

/** GET /occurrences/map?bbox=minLng,minLat,maxLng,maxLat&includeResolved=true&category=... */
export const mapQuerySchema = z.object({
  bbox,
  includeResolved: bool,
  category: categorySchema.optional(),
  limit: limit(500, 300),
});

export const listQuerySchema = z.object({
  limit: limit(100, 30),
  cursor: z.string().max(200).optional(),
  status: statusSchema.optional(),
  category: categorySchema.optional(),
  bbox: bbox.optional(),
  // Período de criação (dias no horário de Brasília), usado pela planilha da prefeitura.
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const activityQuerySchema = z.object({ limit: limit(50, 12) });

export const notificationsQuerySchema = z.object({
  limit: limit(100, 30),
  cursor: z.string().max(200).optional(),
  unread: bool,
});

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
