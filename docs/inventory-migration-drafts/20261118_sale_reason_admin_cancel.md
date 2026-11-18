# 2026-11-18 sale reason / admin-only cancel

Applied to production (inventory-app-v2), verified by rollback dry-run first.

- `store_sale_lines.reason text` (+ `GRANT UPDATE (reason)` to inventory_executor).
- `inventory_store_create_sale(op, tag, lines, p_reason default null)` and `inventory_store_add_sale_lines(op, sale_id, lines, p_reason default null)`: any line with source `main` needs a reason, else `SALE_REASON_REQUIRED`; reason saved on those lines. Old 3-arg overloads dropped (ACL: authenticated only).
- `inventory_store_cancel_sale`: roles now `['admin']` only. Restore stays per line source (main -> `store_sale_return` to main, store -> `sale_cancel` to store).
- `inventory_store_list_sales` lines now include `reason`.
