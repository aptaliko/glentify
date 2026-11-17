CREATE TABLE "dances" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" integer
);
--> statement-breakpoint
ALTER TABLE "dances" ADD CONSTRAINT "dances_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;