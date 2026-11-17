# 2026-11-17 store_sale_tag_required_unless_main_only (applied to production)

inv_store_sale_apply: when the tag is empty and any line is not source='main', raise SALE_TAG_REQUIRED.
Covers inventory_store_create_sale (no tag + store line) and inventory_store_add_sale_lines (store line added to a sale still waiting for tag).
Verified by rolled-back test: store line w/o tag blocked; main-only w/o tag OK (pending); store line into pending sale blocked; tagged store sale OK. No test data left.
