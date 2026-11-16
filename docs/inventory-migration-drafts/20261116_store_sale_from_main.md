# 2026-11-16 store_sale_from_main_pending_tag_pins (applied to production via Supabase migration)

- inventory_operations kind check += store_sale_tag, store_pin
- inventory_movements reason check += store_sale (delta<0), store_sale_return (delta>0)
- store_sales.tag / tag_key nullable (both null or both set, length 3..64); unique active tag index unchanged
- store_sale_lines.source ('store'|'main'; main only for materials)
- new table store_quick_items (pinned materials, RLS + executor policy)
- patched: inv_check_movement, inventory_balance_report, inventory_store_list_sales (pending flag), inventory_store_report (main_sales, pending), inventory_store_cancel_sale
- new helpers inv_store_sale_lines / inv_store_sale_apply; rewritten inventory_store_create_sale / inventory_store_add_sale_lines
- new RPCs: inventory_store_set_sale_tag, inventory_store_list_main_items, inventory_store_set_pin
- allow_store_role_in_account_function: stock_manage_profile accepts role 'store'
Verified with rolled-back transaction tests; no test data left.
