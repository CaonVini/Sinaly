CREATE TYPE "public"."occurrence_source" AS ENUM('app', 'prefeitura');--> statement-breakpoint
ALTER TABLE "occurrences" ADD COLUMN "source" "occurrence_source" DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "occurrences" ADD COLUMN "reporter_contact_enc" text;