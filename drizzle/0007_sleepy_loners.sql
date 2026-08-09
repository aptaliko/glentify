ALTER TABLE "composers" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "dromoi" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "genres" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "rhythms" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "composers" ADD CONSTRAINT "composers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dromoi" ADD CONSTRAINT "dromoi_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genres" ADD CONSTRAINT "genres_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rhythms" ADD CONSTRAINT "rhythms_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;