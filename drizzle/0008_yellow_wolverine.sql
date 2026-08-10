CREATE TABLE "program_collaborators" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "program_collaborators_program_id_user_id_unique" UNIQUE("program_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "program_collaborators" ADD CONSTRAINT "program_collaborators_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_collaborators" ADD CONSTRAINT "program_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;