-- The audit log is append-only: block UPDATE and DELETE at the database level.
CREATE OR REPLACE FUNCTION audit_log_block_changes() RETURNS trigger AS $$
BEGIN
  -- Only the automated test reset may clear it (never set by the app).
  IF current_setting('cc.test_reset', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'The audit log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION audit_log_block_changes();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION audit_log_block_changes();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_changes();
