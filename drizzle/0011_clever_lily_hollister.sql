ALTER TABLE "program_sequences" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;