# 2026-11-18 store return / min threshold / transfer list

Applied to production (project inventory-app-v2) and verified by rollback dry-run.

- `store_stock.min_qty numeric` (+CHECK null or >= 0).
- operation kinds `store_return`, `store_min`; movement reason `store_return` (delta > 0); store movement kind `transfer_out` (delta < 0); `inv_check_movement` pairs reason `store_return` with kind `store_return`.
- New RPCs: `inventory_store_return(p_operation_id, p_lines, p_note)` (admin), `inventory_store_set_min(p_operation_id, p_item_kind, p_item_id, p_min_qty)` (admin; null clears), `inventory_store_list_transfers(p_date_from, p_date_to, p_timezone, p_limit)` (admin/store/purchasing).
- Replaced: `inventory_store_list_stock` (adds min_qty; keeps rows with a threshold at qty 0), `inventory_balance_report` (column store_return), `inventory_store_report` (column transfer_out; closing = opening + in - out - sold + cancelled + adj_in - adj_out).
- Return takes store stock first, then credits main (`inv_move ... 'store_return'`); models return BOM x qty using the CURRENT BOM.
