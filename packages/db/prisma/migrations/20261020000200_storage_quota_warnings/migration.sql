-- STORAGE_QUOTA: the owner and the administrators are told when the stored files reach 80 % and 95 % of what the plan
-- includes. `quota_warning_level` is the highest threshold already announced, so each one is announced once; it goes
-- back down (silently) when the usage falls or the limit grows, and the next crossing is announced again.
ALTER TABLE tenant_usage ADD COLUMN quota_warning_level smallint NOT NULL DEFAULT 0
  CONSTRAINT tenant_usage_quota_warning_level_check CHECK (quota_warning_level IN (0, 80, 95));
