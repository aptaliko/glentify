CREATE TABLE "dromoi" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer
);
--> statement-breakpoint
CREATE TABLE "rhythms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_played_songs" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"song_id" integer NOT NULL,
	"played_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"current_song_id" integer
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"lyrics" text NOT NULL,
	"region_id" integer NOT NULL,
	"rhythm_id" integer NOT NULL,
	"dromos_id" integer NOT NULL,
	"genre_id" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transition_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_rhythm_id" integer NOT NULL,
	"to_rhythm_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_played_songs" ADD CONSTRAINT "session_played_songs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_played_songs" ADD CONSTRAINT "session_played_songs_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_current_song_id_songs_id_fk" FOREIGN KEY ("current_song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_rhythm_id_rhythms_id_fk" FOREIGN KEY ("rhythm_id") REFERENCES "public"."rhythms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_dromos_id_dromoi_id_fk" FOREIGN KEY ("dromos_id") REFERENCES "public"."dromoi"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_rules" ADD CONSTRAINT "transition_rules_from_rhythm_id_rhythms_id_fk" FOREIGN KEY ("from_rhythm_id") REFERENCES "public"."rhythms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_rules" ADD CONSTRAINT "transition_rules_to_rhythm_id_rhythms_id_fk" FOREIGN KEY ("to_rhythm_id") REFERENCES "public"."rhythms"("id") ON DELETE no action ON UPDATE no action;