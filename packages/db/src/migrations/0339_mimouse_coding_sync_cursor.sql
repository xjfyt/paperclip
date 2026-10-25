ALTER TABLE "mimouse_coding_deliveries" ADD COLUMN "sync_lease" uuid;--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD COLUMN "sync_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD COLUMN "next_sync_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD COLUMN "sync_last_code" text;--> statement-breakpoint
CREATE INDEX "mimouse_coding_poll_due_idx" ON "mimouse_coding_deliveries" USING btree ("operation_state","next_sync_at");