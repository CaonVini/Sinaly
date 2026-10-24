import {
  geometry,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { CATEGORIES, ROLES, SOURCES, STATUSES } from "@sinaly/shared";

export const roleEnum = pgEnum("role", ROLES);
export const categoryEnum = pgEnum("category", CATEGORIES);
export const statusEnum = pgEnum("status", STATUSES);
export const sourceEnum = pgEnum("occurrence_source", SOURCES);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("cidadao"),
  isActive: boolean("is_active").notNull().default(true),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // Só funcionário: segredo TOTP cifrado (AES-256-GCM) e último passo aceito (anti-replay).
  totpSecretEnc: text("totp_secret_enc"),
  totpLastStep: integer("totp_last_step"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const occurrences = pgTable(
  "occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").notNull().references(() => users.id),
    category: categoryEnum("category").notNull(),
    description: text("description").notNull(),
    // Ponto WGS84 (x = longitude, y = latitude). Consultas do mapa usam bbox (&&) com o índice GiST.
    location: geometry("location", { type: "point", mode: "xy", srid: 4326 }).notNull(),
    neighborhood: text("neighborhood"),
    photoKey: text("photo_key"),
    status: statusEnum("status").notNull().default("nao_verificado"),
    moderationFlag: text("moderation_flag"),
    // "prefeitura" = cadastrada por funcionário (ex.: ligação). Contato de quem ligou fica cifrado (JSON).
    source: sourceEnum("source").notNull().default("app"),
    reporterContactEnc: text("reporter_contact_enc"),
    // Preenchido ao virar "resolvido" e limpo se for reaberta; a regra dos 5 dias no mapa usa este campo.
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("occurrences_location_gist").using("gist", t.location),
    index("occurrences_status_idx").on(t.status, t.resolvedAt),
    index("occurrences_created_idx").on(t.createdAt, t.id),
    index("occurrences_author_idx").on(t.authorId),
  ],
);

export const statusHistory = pgTable(
  "status_history",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    occurrenceId: uuid("occurrence_id").notNull().references(() => occurrences.id, { onDelete: "cascade" }),
    fromStatus: statusEnum("from_status"),
    toStatus: statusEnum("to_status").notNull(),
    changedBy: uuid("changed_by").references(() => users.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("status_history_occurrence_idx").on(t.occurrenceId)],
);


// Dados pessoais do cidadão (onboarding). CPF nunca fica em texto puro:
// cpf_hash (HMAC) serve para unicidade/busca, cpf_enc (AES-GCM) para exibição autorizada.
export const citizenProfiles = pgTable("citizen_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull(),
  cpfHash: text("cpf_hash").notNull().unique(),
  cpfEnc: text("cpf_enc").notNull(),
  cep: text("cep").notNull(),
  street: text("street").notNull(),
  number: text("number").notNull(),
  complement: text("complement"),
  neighborhood: text("neighborhood").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Uma linha por refresh token. Todos de uma mesma cadeia (rotação) compartilham family_id.
// Reuso de um token já rotacionado revoga a cadeia inteira.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_family_idx").on(t.familyId), index("sessions_user_idx").on(t.userId)],
);

export const authEvents = pgTable(
  "auth_events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    event: text("event").notNull(),
    email: text("email"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_events_user_idx").on(t.userId, t.createdAt)],
);

// Trilha de auditoria: SOMENTE inserção (um trigger no banco bloqueia UPDATE e DELETE).
export const occurrenceAudit = pgTable(
  "occurrence_audit",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    occurrenceId: uuid("occurrence_id").notNull().references(() => occurrences.id),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    actorRole: roleEnum("actor_role").notNull(),
    action: text("action").notNull(), // create | update | status_change | photo_replace
    changes: jsonb("changes").notNull().default({}), // { campo: { from, to } }
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("occurrence_audit_occ_idx").on(t.occurrenceId, t.createdAt), index("occurrence_audit_actor_idx").on(t.actorId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    occurrenceId: uuid("occurrence_id").references(() => occurrences.id),
    type: text("type").notNull(), // status_changed
    title: text("title").notNull(),
    body: text("body").notNull(),
    fromStatus: statusEnum("from_status"),
    toStatus: statusEnum("to_status"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt, t.id)],
);
