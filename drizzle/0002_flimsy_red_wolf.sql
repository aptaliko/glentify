CREATE TABLE "axis_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"lookup_table" text,
	"hierarchical" boolean DEFAULT false NOT NULL,
	CONSTRAINT "axis_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "composers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "song_axis_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"song_id" integer NOT NULL,
	"axis_type" text NOT NULL,
	"ref_id" integer,
	"year_value" integer,
	CONSTRAINT "song_axis_values_song_id_axis_type_unique" UNIQUE("song_id","axis_type")
);
--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "region_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "rhythm_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ALTER COLUMN "dromos_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "song_axis_values" ADD CONSTRAINT "song_axis_values_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_axis_values" ADD CONSTRAINT "song_axis_values_axis_type_axis_types_key_fk" FOREIGN KEY ("axis_type") REFERENCES "public"."axis_types"("key") ON DELETE no action ON UPDATE no action;