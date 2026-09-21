ALTER TYPE "public"."inventory_movement_type" ADD VALUE 'fulfillment';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfilled_at" timestamp with time zone;