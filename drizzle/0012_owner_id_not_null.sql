ALTER TABLE "programs" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "owner_id" SET NOT NULL;
