import { z } from "zod";

/** Identificadores (slugs) de categoria e status: minúsculas, números e "_". Os valores vêm do banco e a prefeitura edita. */
export const slugSchema = z.string().regex(/^[a-z0-9_]{2,40}$/, "Identificador inválido");
export const categorySchema = slugSchema;
export type Category = string;

export const ROLES = ["cidadao", "servidor", "gestor"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const statusSchema = slugSchema;
export type Status = string;

/**
 * Tipo do status: é ele (e não o nome) que define as regras do sistema.
 *  - initial:  ocorrência recém-registrada; não aparece no mapa público; tem um só (não verificado).
 *  - active:   em andamento; aparece no mapa público. Pode haver vários, a prefeitura cria os seus.
 *  - resolved: resolvida; aparece no mapa por N dias e guarda a data de resolução.
 *  - rejected: recusada; não aparece no mapa e exige motivo.
 */
export const STATUS_KINDS = ["initial", "active", "resolved", "rejected"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

export const ICON_KEYS = [
  "shield", "wrench", "signpost", "droplet", "lightbulb", "trash", "tree", "bus", "zap", "building", "construction", "car", "flame", "siren", "paw", "hard-hat",
] as const;
export type IconKey = (typeof ICON_KEYS)[number];

export type CategoryMeta = { slug: Category; name: string; color: string; icon: IconKey; active: boolean; system: boolean; sort: number };
export type StatusMeta = { slug: Status; name: string; color: string; kind: StatusKind; isEntry: boolean; active: boolean; system: boolean; sort: number };
export type Meta = { categories: CategoryMeta[]; statuses: StatusMeta[]; resolvedVisibleDays: number };

/** Dados iniciais (migração 0004). Os "system" não podem ser apagados nem mudar de tipo. */
export const SYSTEM_CATEGORIES: Pick<CategoryMeta, "slug" | "name" | "color" | "icon">[] = [
  { slug: "seguranca", name: "Segurança", color: "#dc2626", icon: "shield" },
  { slug: "infraestrutura", name: "Infraestrutura", color: "#2563eb", icon: "wrench" },
  { slug: "sinalizacao", name: "Sinalização", color: "#9333ea", icon: "signpost" },
  { slug: "saneamento", name: "Saneamento", color: "#0891b2", icon: "droplet" },
  { slug: "iluminacao", name: "Iluminação", color: "#ca8a04", icon: "lightbulb" },
];
export const SYSTEM_STATUSES: Pick<StatusMeta, "slug" | "name" | "color" | "kind" | "isEntry">[] = [
  { slug: "nao_verificado", name: "Não verificado", color: "#e5a400", kind: "initial", isEntry: false },
  { slug: "em_analise", name: "Em análise", color: "#2563eb", kind: "active", isEntry: true },
  { slug: "em_atendimento", name: "Em atendimento", color: "#f97316", kind: "active", isEntry: false },
  { slug: "resolvido", name: "Resolvido", color: "#15803d", kind: "resolved", isEntry: false },
  { slug: "recusado", name: "Recusado", color: "#ef4444", kind: "rejected", isEntry: false },
];

/** Depois de resolvida, a ocorrência some do mapa após N dias (volta com o filtro "resolvidos"). */
export const RESOLVED_VISIBLE_DAYS = 5;

/** Status que qualquer pessoa pode ver no mapa público (resolvidos só pelos primeiros N dias). */
export const isPublicKind = (k: StatusKind) => k === "active" || k === "resolved";

/**
 * Transições permitidas, por tipo (valem para os status do sistema e para os criados pela prefeitura):
 *  initial  -> primeiro estágio (isEntry) ou rejected
 *  active   -> outro active, resolved; rejected só a partir do primeiro estágio
 *  resolved -> active que não seja o primeiro estágio (reabrir)
 *  rejected -> initial (reconsiderar)
 * Com os 5 status originais isso reproduz exatamente o fluxo antigo.
 */
export function canTransition(from: StatusMeta, to: StatusMeta): boolean {
  if (from.slug === to.slug || !to.active) return false;
  switch (from.kind) {
    case "initial":
      return (to.kind === "active" && to.isEntry) || to.kind === "rejected";
    case "active":
      return to.kind === "active" || to.kind === "resolved" || (to.kind === "rejected" && from.isEntry);
    case "resolved":
      return to.kind === "active" && !to.isEntry;
    case "rejected":
      return to.kind === "initial";
  }
}
export const allowedTargets = (from: StatusMeta, all: StatusMeta[]) => all.filter((t) => canTransition(from, t));

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida (use #RRGGBB)");

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
  // Bairro/referência do local (opcional; campo vazio vale como não informado).
  neighborhood: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), text(2, 80).optional()),
  lat: numberField.pipe(latitude),
  lng: numberField.pipe(longitude),
});
export type CreateOccurrenceFields = z.infer<typeof createOccurrenceFieldsSchema>;

export const SOURCES = ["app", "prefeitura"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABELS: Record<Source, string> = { app: "Aplicativo", prefeitura: "Prefeitura" };

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Cadastro manual pela prefeitura (multipart; a foto é opcional). Contato de quem ligou é opcional. */
export const staffCreateFieldsSchema = createOccurrenceFieldsSchema.extend({
  // Padrão: primeiro estágio ("em_analise"); a API valida que o status existe, está ativo e não é resolvido/recusado.
  status: statusSchema.default("em_analise"),
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
    neighborhood: text(2, 80).optional(),
    lat: latitude.optional(),
    lng: longitude.optional(),
    status: statusSchema.optional(),
    note: text(1, 500).optional(),
  })
  .strict()
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), "Informe lat e lng juntos")
  .refine(
    (v) => v.category !== undefined || v.description !== undefined || v.neighborhood !== undefined || v.lat !== undefined || v.status !== undefined,
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
  order: z.enum(["asc", "desc"]).default("desc"),
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

// ---------- Configuração (só gestor) ----------
const configName = text(2, 40);
export const categoryCreateSchema = z.object({ name: configName, color: hexColor, icon: z.enum(ICON_KEYS) }).strict();
export const categoryPatchSchema = z
  .object({ name: configName.optional(), color: hexColor.optional(), icon: z.enum(ICON_KEYS).optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nada para alterar");
// Status criados pela prefeitura são sempre "em andamento" (active); o tipo dos status do sistema não muda.
export const statusCreateSchema = z.object({ name: configName, color: hexColor }).strict();
export const statusPatchSchema = z
  .object({ name: configName.optional(), color: hexColor.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nada para alterar");
export const orderSchema = z.object({ slugs: z.array(slugSchema).min(1).max(200) }).strict();

/** Slug a partir do nome: sem acento, minúsculo, "_" entre palavras. */
export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  return base.length >= 2 ? base : `item_${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- Relatórios ----------
export const reportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: categorySchema.optional(),
  status: statusSchema.optional(),
});
