-- SAME_AS_STEP: the step goes to whoever delivered another step of the same ticket ("mismo responsable que el paso X"
-- of the help desk). The value is added alone: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE assignment_mode ADD VALUE 'SAME_AS_STEP';
