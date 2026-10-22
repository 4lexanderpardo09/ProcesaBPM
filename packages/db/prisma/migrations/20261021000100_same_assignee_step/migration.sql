-- The step whose assignee a SAME_AS_STEP step takes, always a step of the same version. The foreign key is deferred:
-- a graph save rewrites existing steps before inserting the new ones they may point to. Only other modes are held to
-- null: a draft may choose the mode before the step (like POSITION before its position), and publishing checks it.
ALTER TABLE steps ADD COLUMN same_assignee_step_id uuid;

ALTER TABLE steps
  ADD CONSTRAINT steps_same_assignee_step_fkey FOREIGN KEY (tenant_id, version_id, same_assignee_step_id)
  REFERENCES steps (tenant_id, version_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE steps
  ADD CONSTRAINT steps_same_assignee_step_check CHECK (
    (assignment_mode = 'SAME_AS_STEP' OR same_assignee_step_id IS NULL) AND same_assignee_step_id IS DISTINCT FROM id
  );

CREATE INDEX steps_same_assignee_step_idx ON steps (tenant_id, version_id, same_assignee_step_id) WHERE same_assignee_step_id IS NOT NULL;
