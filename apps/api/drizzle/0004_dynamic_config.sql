CREATE TYPE "public"."status_kind" AS ENUM('initial', 'active', 'resolved', 'rejected');--> statement-breakpoint
CREATE TABLE "categories" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"icon" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_audit" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "config_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actor_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_key" text NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statuses" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"kind" "status_kind" NOT NULL,
	"is_entry" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
--> statement-breakpoint
-- Dados iniciais: os 5 status e 5 categorias originais (system = não podem ser apagados).
INSERT INTO "categories" ("slug","name","color","icon","system","sort") VALUES
 ('seguranca','Segurança','#dc2626','shield',true,0),
 ('infraestrutura','Infraestrutura','#2563eb','wrench',true,1),
 ('sinalizacao','Sinalização','#9333ea','signpost',true,2),
 ('saneamento','Saneamento','#0891b2','droplet',true,3),
 ('iluminacao','Iluminação','#ca8a04','lightbulb',true,4);--> statement-breakpoint
INSERT INTO "statuses" ("slug","name","color","kind","is_entry","system","sort") VALUES
 ('nao_verificado','Não verificado','#e5a400','initial',false,true,0),
 ('em_analise','Em análise','#2563eb','active',true,true,1),
 ('em_atendimento','Em atendimento','#f97316','active',false,true,2),
 ('resolvido','Resolvido','#15803d','resolved',false,true,3),
 ('recusado','Recusado','#ef4444','rejected',false,true,4);--> statement-breakpoint
-- enum -> text preservando os valores (o USING converte; o default antigo precisa sair antes).
ALTER TABLE "occurrences" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "occurrences" ALTER COLUMN "category" SET DATA TYPE text USING "category"::text;--> statement-breakpoint
ALTER TABLE "occurrences" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
ALTER TABLE "occurrences" ALTER COLUMN "status" SET DEFAULT 'nao_verificado';--> statement-breakpoint
ALTER TABLE "status_history" ALTER COLUMN "from_status" SET DATA TYPE text USING "from_status"::text;--> statement-breakpoint
ALTER TABLE "status_history" ALTER COLUMN "to_status" SET DATA TYPE text USING "to_status"::text;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "from_status" SET DATA TYPE text USING "from_status"::text;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "to_status" SET DATA TYPE text USING "to_status"::text;--> statement-breakpoint
ALTER TABLE "config_audit" ADD CONSTRAINT "config_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_uq" ON "categories" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "config_audit_created_idx" ON "config_audit" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "statuses_name_uq" ON "statuses" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_from_status_statuses_slug_fk" FOREIGN KEY ("from_status") REFERENCES "public"."statuses"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_to_status_statuses_slug_fk" FOREIGN KEY ("to_status") REFERENCES "public"."statuses"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_category_categories_slug_fk" FOREIGN KEY ("category") REFERENCES "public"."categories"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_status_statuses_slug_fk" FOREIGN KEY ("status") REFERENCES "public"."statuses"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_from_status_statuses_slug_fk" FOREIGN KEY ("from_status") REFERENCES "public"."statuses"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_to_status_statuses_slug_fk" FOREIGN KEY ("to_status") REFERENCES "public"."statuses"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."category";--> statement-breakpoint
DROP TYPE "public"."status";--> statement-breakpoint
-- Auditoria da configuração: somente inserção, como a das ocorrências.
CREATE TRIGGER config_audit_no_change BEFORE UPDATE OR DELETE ON "config_audit" FOR EACH ROW EXECUTE FUNCTION occurrence_audit_immutable();
