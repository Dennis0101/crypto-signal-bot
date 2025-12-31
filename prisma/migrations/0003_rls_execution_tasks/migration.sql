-- Enable RLS for ExecutionTask and apply per-user policy.
-- Assumes Prisma has created "ExecutionTask" table.

ALTER TABLE "ExecutionTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExecutionTask" FORCE ROW LEVEL SECURITY;

CREATE POLICY executiontask_owner_all ON "ExecutionTask"
  FOR ALL USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

