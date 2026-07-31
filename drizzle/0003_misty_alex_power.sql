ALTER TABLE "transition_rules" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "transition_rules" CASCADE;--> statement-breakpoint
ALTER TABLE "songs" DROP CONSTRAINT "songs_region_id_regions_id_fk";
--> statement-breakpoint
ALTER TABLE "songs" DROP CONSTRAINT "songs_rhythm_id_rhythms_id_fk";
--> statement-breakpoint
ALTER TABLE "songs" DROP CONSTRAINT "songs_dromos_id_dromoi_id_fk";
--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "region_id";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "rhythm_id";--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "dromos_id";