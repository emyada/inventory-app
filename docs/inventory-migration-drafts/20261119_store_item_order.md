# 19 Nov 2026 — store sell-page order
- New table `store_item_order(item_kind, item_id, position, updated_at, updated_by)`, RLS on, `executor_all` policy only, no grants to anon/authenticated.
- New RPCs: `inventory_store_list_order()` (admin/store/purchasing read), `inventory_store_set_order(p_operation_id, p_items jsonb)` (admin; replaces the whole list; validates kind/uuid/no duplicates, max 300).
- `inventory_operations_kind_check` gains `store_order`.
- Seeded 12 rows: Music, AURIS-1, Impax, Dentist, Factory, Swim, Eartips S/M/L/XL, สายคล้องแยก, กล่องใส arc 3.0 Sleepplug_pcs.
- Dry-run (rolled back) before install: store role denied set; replay idempotent; duplicates/bad ids -> ORDER_INVALID; direct SELECT by authenticated denied.
