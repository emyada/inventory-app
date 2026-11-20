# store_channel_date_not_future (applied 2026-11-20)
- New helper `inv_store_tag_date_ok(tag, prefix)`: date after the prefix must exist and be <= today (Asia/Bangkok).
- `inv_store_channel_for(tag)` now also requires it for channels whose spec has `with_date` (Shipnity).
- Existing tags and their channel_code are untouched.
