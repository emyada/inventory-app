-- Duplicate-order rule changed from per model to per CATEGORY (Z1234 = ZG1234 = 1234 within a category).
-- Package (supplemental) work stays per model so it can ride along with its Driver order.
-- APPLIED to inventory-app-v2 on 2026-11-15 as migration "duplicate_orders_per_category".
-- Notes: issued_identity is owned by postgres (index created as postgres, after temporarily granting
-- USAGE,CREATE on schema duplicate_order_private from its owner inventory_executor, revoked afterwards);
-- functions are owned by inventory_executor and were re-created under SET LOCAL ROLE inventory_executor.
CREATE UNIQUE INDEX one_active_primary_per_category ON duplicate_order_private.issued_identity(parent_category, reference_key)
  WHERE released_operation_id IS NULL AND work_kind='primary';
-- register_new_request: prior-order lookup =
--   (policy primary  -> same parent_category AND request work_kind primary) OR (package -> same model_id), same reference_key
-- claim_issues: same condition against issued_identity.
-- one_active_issue_per_model (model_id, reference_key) is kept.
