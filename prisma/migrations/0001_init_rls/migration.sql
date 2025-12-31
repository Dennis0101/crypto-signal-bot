-- Security-first multi-tenant foundation with Postgres RLS.
--
-- IMPORTANT:
-- - This migration assumes the Prisma models have been applied (tables exist).
-- - RLS policies use a session setting `app.user_id`.
--   The API must call: SELECT set_config('app.user_id', '<userId>', true);
--   inside the same transaction as all queries.

-- Helper function to read current user id from setting
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;

-- Enable RLS and apply per-user policies
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- Auth tables are server-only and must be readable before userId is known.
    -- Keep them OUT of RLS to avoid insecure bypasses.
    'ExchangeKey',
    'RiskLimit',
    'TradingHalt',
    'Order',
    'Trade',
    'AuditLog'
  ]
  LOOP
    EXECUTE format('ALTER TABLE "%s" ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE "%s" FORCE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

CREATE POLICY exchangekey_owner_all ON "ExchangeKey"
  FOR ALL USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

CREATE POLICY risklimit_owner_all ON "RiskLimit"
  FOR ALL USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

CREATE POLICY tradinghalt_owner_or_system_select ON "TradingHalt"
  FOR SELECT USING (
    ("scope" = 'SYSTEM') OR ("userId" = app_current_user_id())
  );
CREATE POLICY tradinghalt_owner_insert ON "TradingHalt"
  FOR INSERT WITH CHECK (
    ("scope" = 'SYSTEM') OR ("userId" = app_current_user_id())
  );
CREATE POLICY tradinghalt_owner_update ON "TradingHalt"
  FOR UPDATE USING (
    ("scope" = 'SYSTEM') OR ("userId" = app_current_user_id())
  ) WITH CHECK (
    ("scope" = 'SYSTEM') OR ("userId" = app_current_user_id())
  );

CREATE POLICY order_owner_all ON "Order"
  FOR ALL USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

CREATE POLICY trade_owner_all ON "Trade"
  FOR ALL USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

CREATE POLICY audit_owner_insert_select ON "AuditLog"
  FOR SELECT USING ("userId" = app_current_user_id());
CREATE POLICY audit_owner_insert ON "AuditLog"
  FOR INSERT WITH CHECK ("userId" = app_current_user_id());

