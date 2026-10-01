-- The site tree is enforced by the database (it used to rely on the service alone):
--   * a site with no parent is level 1 and a child is exactly one level below its parent (which also
--     rules out cycles: levels would have to grow around one);
--   * the parent is of the same tenant (already the composite foreign key);
--   * a name is unique among the children of a parent, root sites included (NULLS NOT DISTINCT).
-- Also: INVITED means "not accepted yet" (joined_at is empty), so reactivating a member who never
-- accepted goes back to INVITED instead of being refused.

-- ===========================================================================
-- 1. Unique names per parent, roots included
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sites WHERE parent_id IS NULL GROUP BY tenant_id, name HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'cannot enforce unique root site names: duplicates exist, rename them first';
  END IF;
END
$$;
-- Same name as the Prisma index: the schema keeps @@unique([tenantId, parentId, name]) (Prisma cannot
-- express NULLS NOT DISTINCT, the same way as approval_members_one_group).
DROP INDEX sites_tenant_id_parent_id_name_key;
CREATE UNIQUE INDEX sites_tenant_id_parent_id_name_key ON sites (tenant_id, parent_id, name) NULLS NOT DISTINCT;

-- ===========================================================================
-- 2. Levels
-- ===========================================================================
ALTER TABLE sites ADD CONSTRAINT sites_root_is_level_one CHECK ((parent_id IS NULL) = (level = 1));
ALTER TABLE sites ADD CONSTRAINT sites_max_level CHECK (level <= 20);

-- Deferred: moving a subtree updates the moved site and then each descendant, so the tree is only
-- consistent again at COMMIT. The row is read again (NEW is stale at that point) and checked against
-- its parent and its children. The advisory lock is the one the API takes before it writes the tree:
-- it serializes writers that bypass the service, and the statements after it see a fresh snapshot.
CREATE FUNCTION check_site_tree() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_site record;
    v_parent_level integer;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('sites:' || NEW.tenant_id::text, 0));
    SELECT parent_id, level INTO v_site FROM sites WHERE tenant_id = NEW.tenant_id AND id = NEW.id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    IF v_site.parent_id IS NOT NULL THEN
      SELECT level INTO v_parent_level FROM sites WHERE tenant_id = NEW.tenant_id AND id = v_site.parent_id;
      IF NOT FOUND OR v_site.level <> v_parent_level + 1 THEN
        RAISE EXCEPTION 'site % must be one level below its parent', NEW.id USING ERRCODE = '23514';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM sites c WHERE c.tenant_id = NEW.tenant_id AND c.parent_id = NEW.id AND c.level <> v_site.level + 1) THEN
      RAISE EXCEPTION 'the children of site % must be one level below it', NEW.id USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END
  $$;
CREATE CONSTRAINT TRIGGER check_site_tree AFTER INSERT OR UPDATE OF parent_id, level ON sites
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_site_tree();

-- ===========================================================================
-- 3. INVITED means not accepted yet
-- ===========================================================================
CREATE OR REPLACE FUNCTION trg_membership_no_regress() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT is_privileged_session() AND OLD.joined_at IS NOT NULL AND NEW.joined_at IS NULL THEN
      RAISE EXCEPTION 'joined_at cannot be cleared' USING ERRCODE = '23514';
    END IF;
    IF NOT is_privileged_session() AND NEW.status = 'INVITED' AND NEW.joined_at IS NOT NULL THEN
      RAISE EXCEPTION 'a member who accepted the invitation cannot go back to INVITED' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
