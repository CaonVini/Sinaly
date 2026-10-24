import {
  geometry,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { CATEGORIES, ROLES, STATUSES } from "@sinaly/shared";

export const roleEnum = pgEnum("role", ROLES);
export const categoryEnum = pgEnum("category", CATEGORIES);
export const statusEnum = pgEnum("status", STATUSES);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("cidadao"),
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
    status: statusEnum("status").notNull().default("aguardando_aprovacao"),
    moderationFlag: text("moderation_flag"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("occurrences_location_gist").using("gist", t.location),
    index("occurrences_status_idx").on(t.status),
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

