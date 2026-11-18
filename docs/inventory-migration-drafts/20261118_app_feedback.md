# 2026-11-18 app feedback

Applied to production (inventory-app-v2), rollback dry-run first.

- Table `public.app_feedback` (RLS on, policy only for `inventory_executor`, no grants for anon/authenticated).
- Operation kinds `feedback`, `feedback_resolve`.
- RPCs: `inventory_submit_feedback(op, message, category problem|idea|question, page, context)` (all roles, max 20/hour/user, message 3-1000 chars), `inventory_list_feedback(status, limit)` (admin; returns `{new_count, items}`), `inventory_resolve_feedback(op, id, done)` (admin).
