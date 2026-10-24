-- Renomeia o valor do enum preservando as linhas existentes (o drizzle-kit gerou DROP/CREATE TYPE, que falharia com dados).
ALTER TYPE "public"."status" RENAME VALUE 'aguardando_aprovacao' TO 'nao_verificado';
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"occurrence_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"from_status" "status",
	"to_status" "status",
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occurrence_audit" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "occurrence_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"occurrence_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_role" "role" NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "occurrences_status_idx";
--> statement-breakpoint
ALTER TABLE "occurrences" ADD COLUMN "resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_occurrence_id_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."occurrences"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "occurrence_audit" ADD CONSTRAINT "occurrence_audit_occurrence_id_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."occurrences"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "occurrence_audit" ADD CONSTRAINT "occurrence_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "occurrence_audit_occ_idx" ON "occurrence_audit" USING btree ("occurrence_id","created_at");
--> statement-breakpoint
CREATE INDEX "occurrence_audit_actor_idx" ON "occurrence_audit" USING btree ("actor_id","created_at");
--> statement-breakpoint
CREATE INDEX "occurrences_created_idx" ON "occurrences" USING btree ("created_at","id");
--> statement-breakpoint
CREATE INDEX "occurrences_status_idx" ON "occurrences" USING btree ("status","resolved_at");
--> statement-breakpoint
-- Garante WGS84 (SRID 4326) em toda ocorrência; consultas por bbox e o índice GiST dependem disso.
ALTER TABLE "occurrences" ALTER COLUMN "location" SET DATA TYPE geometry(Point, 4326) USING ST_SetSRID("location", 4326)
--> statement-breakpoint
-- Auditoria imutável: nem o app consegue alterar ou apagar linhas. (Só um dono do banco, removendo o trigger.)
CREATE FUNCTION occurrence_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'occurrence_audit é somente inserção';
END;
$$ LANGUAGE plpgsql
--> statement-breakpoint
CREATE TRIGGER occurrence_audit_no_change BEFORE UPDATE OR DELETE ON "occurrence_audit" FOR EACH ROW EXECUTE FUNCTION occurrence_audit_immutable();
