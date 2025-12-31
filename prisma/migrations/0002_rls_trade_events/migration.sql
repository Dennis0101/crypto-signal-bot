-- Enable RLS for TradeEvent and apply per-user policy.
-- Assumes Prisma has created "TradeEvent" table.

ALTER TABLE "TradeEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradeEvent" FORCE ROW LEVEL SECURITY;

CREATE POLICY tradeevent_owner_all ON "TradeEvent"
  FOR ALL USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

