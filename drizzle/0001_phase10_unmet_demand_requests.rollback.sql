-- Phase 10 (Phase B): Rollback Script for unmet_demand_requests
-- Removes only the additive unmet_demand_requests table and its indexes.
-- Zero impact on existing operational tables.

DROP INDEX IF EXISTS "unmet_demand_dedupe_idx";
DROP INDEX IF EXISTS "unmet_demand_reason_idx";
DROP INDEX IF EXISTS "unmet_demand_branch_time_idx";
DROP INDEX IF EXISTS "unmet_demand_product_time_idx";
DROP INDEX IF EXISTS "unmet_demand_timestamp_idx";
DROP INDEX IF EXISTS "unmet_demand_idempotency_idx";
DROP TABLE IF EXISTS "unmet_demand_requests";
