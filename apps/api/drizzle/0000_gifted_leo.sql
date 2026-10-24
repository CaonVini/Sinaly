CREATE TYPE "public"."category" AS ENUM('seguranca', 'infraestrutura', 'sinalizacao', 'saneamento', 'iluminacao');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('cidadao', 'servidor', 'gestor');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('aguardando_aprovacao', 'em_analise', 'em_atendimento', 'resolvido', 'recusado');--> statement-breakpoint
CREATE TABLE "occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"category" "category" NOT NULL,
	"description" text NOT NULL,
	"location" geometry(point) NOT NULL,
	"neighborhood" text,
	"photo_key" text,
	"status" "status" DEFAULT 'aguardando_aprovacao' NOT NULL,
	"moderation_flag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "status_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"occurrence_id" uuid NOT NULL,
	"from_status" "status",
	"to_status" "status" NOT NULL,
	"changed_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'cidadao' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_occurrence_id_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "occurrences_location_gist" ON "occurrences" USING gist ("location");--> statement-breakpoint
CREATE INDEX "occurrences_status_idx" ON "occurrences" USING btree ("status");--> statement-breakpoint
CREATE INDEX "occurrences_author_idx" ON "occurrences" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "status_history_occurrence_idx" ON "status_history" USING btree ("occurrence_id");