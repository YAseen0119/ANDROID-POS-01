-- Phase 10 (Phase B): Additive Migration for Customer Demand Intelligence (Unmet Demand Requests)
-- STATUS: PREPARED FOR APPROVAL ONLY — DO NOT EXECUTE AUTOMATICALLY
-- Protection Guarantee: Strictly additive (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
-- Does not alter, drop, truncate, or modify any existing table or record.

CREATE TABLE IF NOT EXISTS "unmet_demand_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL,
  "dedupe_fingerprint" text NOT NULL,
  "product_id" text REFERENCES "products"("id") ON DELETE SET NULL,
  "is_registered_product" boolean DEFAULT true NOT NULL,
  "product_name_snapshot" text NOT NULL,
  "product_name_ar_snapshot" text,
  "sku_snapshot" text,
  "barcode" text,
  "category_snapshot" text DEFAULT 'General' NOT NULL,
  "branch_id" text REFERENCES "branches"("id") ON DELETE SET NULL,
  "terminal_name" text,
  "requested_timestamp" timestamp DEFAULT now() NOT NULL,
  "requested_quantity" integer DEFAULT 1 NOT NULL,
  "sale_unit_mode" text DEFAULT 'unit' NOT NULL,
  "requested_base_units" integer DEFAULT 1 NOT NULL,
  "available_stock_at_request" integer,
  "availability_status" text NOT NULL,
  "unavailability_reason" text NOT NULL,
  "confirmed_purchase_intent" boolean DEFAULT false NOT NULL,
  "fulfillment_status" text DEFAULT 'unfulfilled' NOT NULL,
  "customer_id" text REFERENCES "customers"("id") ON DELETE SET NULL,
  "customer_reference" text,
  "unit_selling_price_snapshot" numeric(12, 2),
  "unit_cost_price_snapshot" numeric(12, 2),
  "currency_snapshot" text DEFAULT 'SDG' NOT NULL,
  "exchange_rate_snapshot" numeric(16, 6) DEFAULT '1.000000' NOT NULL,
  "notes" text,
  "recorded_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "recorded_by_name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "unmet_demand_qty_positive_chk" CHECK ("requested_quantity" > 0 AND "requested_quantity" <= 10000),
  CONSTRAINT "unmet_demand_base_units_positive_chk" CHECK ("requested_base_units" > 0),
  CONSTRAINT "unmet_demand_reason_valid_chk" CHECK (
    "unavailability_reason" IN (
      'OUT_OF_STOCK',
      'EXPIRED',
      'NOT_STOCKED',
      'TEMPORARILY_UNAVAILABLE',
      'OTHER'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "unmet_demand_idempotency_idx"
  ON "unmet_demand_requests" ("idempotency_key");

CREATE INDEX IF NOT EXISTS "unmet_demand_timestamp_idx"
  ON "unmet_demand_requests" ("requested_timestamp" DESC);

CREATE INDEX IF NOT EXISTS "unmet_demand_product_time_idx"
  ON "unmet_demand_requests" ("product_id", "requested_timestamp" DESC);

CREATE INDEX IF NOT EXISTS "unmet_demand_branch_time_idx"
  ON "unmet_demand_requests" ("branch_id", "requested_timestamp" DESC);

CREATE INDEX IF NOT EXISTS "unmet_demand_reason_idx"
  ON "unmet_demand_requests" ("unavailability_reason");

CREATE INDEX IF NOT EXISTS "unmet_demand_dedupe_idx"
  ON "unmet_demand_requests" ("dedupe_fingerprint", "requested_timestamp" DESC);
