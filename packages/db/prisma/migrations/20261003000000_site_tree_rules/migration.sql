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
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sites c JOIN sites p ON p.tenant_id = c.tenant_id AND p.id = c.parent_id WHERE c.level <> p.level + 1) THEN
    RAISE EXCEPTION 'cannot enforce the site tree: some sites are not one level below their parent, fix them first';
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

-- ===========================================================================
-- 4. Full access also through `manage all`, and revived invitations
-- ===========================================================================
-- The API treats a role holding `manage all` as full access whether or not it is flagged admin, so the
-- guards of migration 20261002 must too: otherwise someone with only `update Membership` could give
-- themselves such a role, or reactivate a deactivated one.
CREATE FUNCTION role_grants_full_access(p_tenant_id uuid, p_role_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM roles r WHERE r.tenant_id = p_tenant_id AND r.id = p_role_id AND r.is_admin)
        OR EXISTS (
          SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.tenant_id = p_tenant_id AND rp.role_id = p_role_id AND p.action = 'manage' AND p.subject = 'all'
        )
  $$;

CREATE OR REPLACE FUNCTION acting_user_has_full_access(p_tenant_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM memberships m JOIN roles r ON r.tenant_id = m.tenant_id AND r.id = m.role_id
      WHERE m.tenant_id = p_tenant_id AND m.user_id = app_current_user() AND m.status = 'ACTIVE'
        AND (m.is_owner OR (r.is_active AND role_grants_full_access(m.tenant_id, m.role_id)))
    )
  $$;

CREATE OR REPLACE FUNCTION trg_guard_membership_privilege() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF is_privileged_session() THEN
      RETURN NEW;
    END IF;

    -- Clearing the owner flag: only the owner themself, and it opens the transfer window.
    IF TG_OP = 'UPDATE' AND OLD.is_owner AND NOT NEW.is_owner THEN
      IF OLD.user_id IS DISTINCT FROM app_current_user() THEN
        RAISE EXCEPTION 'only the owner can give up the ownership' USING ERRCODE = '42501';
      END IF;
      PERFORM set_config('app.ownership_transfer', NEW.tenant_id::text || ':' || OLD.user_id::text, true);
    END IF;

    -- Setting the owner flag.
    IF NEW.is_owner AND (TG_OP = 'INSERT' OR NOT OLD.is_owner) THEN
      IF coalesce(current_setting('app.ownership_transfer', true), '') <> NEW.tenant_id::text || ':' || coalesce(app_current_user()::text, '') THEN
        RAISE EXCEPTION 'only the owner can transfer the ownership' USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Giving a role with full access, or bringing back (to INVITED or ACTIVE) a member of one.
    IF TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id
       OR (NEW.status <> 'INACTIVE' AND OLD.status = 'INACTIVE') THEN
      IF role_grants_full_access(NEW.tenant_id, NEW.role_id) AND NOT acting_user_has_full_access(NEW.tenant_id) THEN
        RAISE EXCEPTION 'only an administrator can give a role with full access' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;

CREATE OR REPLACE FUNCTION trg_guard_role_privilege() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    -- Becoming an active role with full access (created, marked admin, or reactivated) is a grant of it.
    IF NEW.is_active AND (NEW.is_admin OR role_grants_full_access(NEW.tenant_id, NEW.id))
       AND (TG_OP = 'INSERT' OR NOT (OLD.is_active AND (OLD.is_admin OR role_grants_full_access(OLD.tenant_id, OLD.id))))
       AND NOT is_privileged_session() AND NOT acting_user_has_full_access(NEW.tenant_id) THEN
      RAISE EXCEPTION 'only an administrator can create, mark or reactivate a role with full access' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;
