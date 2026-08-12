ALTER TABLE "songs" DROP CONSTRAINT "songs_genre_id_genres_id_fk";
--> statement-breakpoint
ALTER TABLE "songs" DROP COLUMN "genre_id";