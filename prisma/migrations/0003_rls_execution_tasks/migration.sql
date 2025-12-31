-- ExecutionTask is an internal server queue table.
--
-- We intentionally do NOT enable RLS here because the worker must be able to
-- lease tasks across *all* users before it knows which user context to set.
--
-- Data isolation is enforced at the API layer:
-- - API endpoints list/create tasks only within a user-scoped transaction.
-- - Worker sets app.user_id when reading/writing any user-owned RLS tables.

