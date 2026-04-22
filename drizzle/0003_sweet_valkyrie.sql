CREATE TABLE "stories_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"synced_at" timestamp DEFAULT now(),
	"date" text NOT NULL,
	"total_stories" integer DEFAULT 0,
	"total_views" integer DEFAULT 0,
	CONSTRAINT "stories_history_client_id_date_unique" UNIQUE("client_id","date")
);
--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "followers_count" integer;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "profile_picture_url" text;--> statement-breakpoint
ALTER TABLE "posts_cache" ADD COLUMN "link_clicks" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "posts_cache" ADD COLUMN "media_url" text;--> statement-breakpoint
ALTER TABLE "stories_history" ADD CONSTRAINT "stories_history_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;