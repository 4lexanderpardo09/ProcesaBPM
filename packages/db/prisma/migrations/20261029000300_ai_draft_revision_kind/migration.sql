-- «Crear con IA» as a chat: a request may ask for a change to the current draft instead of a new one. The value is
-- added alone: a new enum value cannot be used in the transaction that adds it (the rule is in the next migration).
ALTER TYPE ai_task_kind ADD VALUE 'WORKFLOW_DRAFT_REVISION';
