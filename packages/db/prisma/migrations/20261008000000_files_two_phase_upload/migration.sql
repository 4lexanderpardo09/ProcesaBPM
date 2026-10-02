-- Two-phase file upload: a file is reserved (PENDING), uploaded by the client straight to storage,
-- verified (CONFIRMED) and finally linked to a business record (linked_at). See docs/base-de-datos.md §8.14.

ALTER TABLE stored_files ADD COLUMN linked_at timestamptz(3);

-- 1. The storage key is fully determined by the row: nobody can point a file at another tenant's object.
ALTER TABLE stored_files ADD CONSTRAINT stored_files_key_format CHECK (
  storage_key ~ ('^tenants/' || tenant_id::text || '/[0-9]{4}/[0-9]{2}/' || id::text || '$'));

ALTER TABLE stored_files ADD CONSTRAINT stored_files_lifecycle CHECK (
  (status = 'PENDING'   AND confirmed_at IS NULL AND linked_at IS NULL AND deleted_at IS NULL) OR
  (status = 'CONFIRMED' AND confirmed_at IS NOT NULL AND deleted_at IS NULL) OR
  (status = 'DELETED'   AND confirmed_at IS NOT NULL AND deleted_at IS NOT NULL));

-- 2. A user upload is attached to a ticket once, ever (a second attachment would be a copy).
CREATE UNIQUE INDEX ticket_documents_one_attachment ON ticket_documents (tenant_id, file_id) WHERE role = 'ATTACHMENT';

-- Cross-tenant scan for the purge job (SQL only, like sla_clocks_due).
CREATE INDEX stored_files_unlinked ON stored_files (created_at) WHERE linked_at IS NULL AND status <> 'DELETED';

-- 3. A stored file is immutable once verified; only abandoned uploads are ever removed.
CREATE FUNCTION trg_guard_stored_file() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF app_is_purging(OLD.tenant_id) THEN
      RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
      IF OLD.linked_at IS NOT NULL OR OLD.status = 'DELETED' THEN
        RAISE EXCEPTION 'file % is linked or logically deleted and cannot be removed', OLD.id USING ERRCODE = '23001';
      END IF;
      RETURN OLD;
    END IF;

    IF NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.storage_key <> OLD.storage_key
       OR NEW.origin <> OLD.origin OR NEW.created_at <> OLD.created_at
       OR NEW.uploaded_by_id IS DISTINCT FROM OLD.uploaded_by_id THEN
      RAISE EXCEPTION 'identity columns of file % are immutable', OLD.id USING ERRCODE = '23001';
    END IF;
    IF OLD.status <> 'PENDING' THEN
      IF NEW.status = 'PENDING' THEN
        RAISE EXCEPTION 'file % cannot go back to PENDING', OLD.id USING ERRCODE = '23001';
      END IF;
      IF NEW.size_bytes <> OLD.size_bytes OR NEW.sha256 <> OLD.sha256 OR NEW.mime_type <> OLD.mime_type
         OR NEW.original_name <> OLD.original_name THEN
        RAISE EXCEPTION 'content columns of file % are immutable once verified', OLD.id USING ERRCODE = '23001';
      END IF;
    END IF;
    IF (OLD.linked_at IS NOT NULL AND NEW.linked_at IS DISTINCT FROM OLD.linked_at)
       OR (OLD.company_id IS NOT NULL AND NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
      RAISE EXCEPTION 'file % link is set once', OLD.id USING ERRCODE = '23001';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER stored_files_guard BEFORE UPDATE OR DELETE ON stored_files
  FOR EACH ROW EXECUTE FUNCTION trg_guard_stored_file();

-- 4. Only verified files can be attached to a ticket.
CREATE FUNCTION trg_ticket_document_file_confirmed() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_status file_status;
  BEGIN
    SELECT status INTO v_status FROM stored_files WHERE tenant_id = NEW.tenant_id AND id = NEW.file_id;
    IF v_status IS DISTINCT FROM 'CONFIRMED' THEN
      RAISE EXCEPTION 'file % is not confirmed and cannot be attached', NEW.file_id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER ticket_documents_file_confirmed BEFORE INSERT ON ticket_documents
  FOR EACH ROW EXECUTE FUNCTION trg_ticket_document_file_confirmed();

-- 5. Worker: tenants that hold abandoned uploads. Only ids leave the function; the deletion itself runs in each
-- tenant's own context (RLS applies and the quota counter is adjusted in the same transaction).
CREATE FUNCTION find_tenants_with_stale_uploads(p_cutoff timestamptz, p_limit integer) RETURNS TABLE (out_tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT tenant_id FROM stored_files
    WHERE linked_at IS NULL AND status <> 'DELETED' AND origin = 'USER' AND created_at < p_cutoff
    LIMIT p_limit
  $$;

ALTER FUNCTION find_tenants_with_stale_uploads(timestamptz, integer) OWNER TO app_platform;
REVOKE ALL ON FUNCTION find_tenants_with_stale_uploads(timestamptz, integer) FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION find_tenants_with_stale_uploads(timestamptz, integer) TO app_worker;
