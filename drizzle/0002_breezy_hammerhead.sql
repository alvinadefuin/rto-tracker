CREATE TABLE IF NOT EXISTS "ph_holidays" (
	"date" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "day_entries" ADD COLUMN IF NOT EXISTS "note" text;