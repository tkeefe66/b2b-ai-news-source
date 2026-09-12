-- Additive only. Review and apply to the confirmed production database before deployment.
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS delivery_payload TEXT;
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMP;
