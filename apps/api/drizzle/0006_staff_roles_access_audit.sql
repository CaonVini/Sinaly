ALTER TYPE "public"."role" ADD VALUE 'admin';--> statement-breakpoint
CREATE TABLE "access_audit" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "access_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actor_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_audit" ADD CONSTRAINT "access_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_audit_created_idx" ON "access_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "access_audit_actor_idx" ON "access_audit" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "access_audit_subject_idx" ON "access_audit" USING btree ("subject_type","subject_id");--> statement-breakpoint
-- Trilha de acesso: somente inserção (mesmo gatilho das outras auditorias).
CREATE TRIGGER access_audit_no_change BEFORE UPDATE OR DELETE ON "access_audit" FOR EACH ROW EXECUTE FUNCTION occurrence_audit_immutable();
