-- Jiro in the PDF format designer: a request may design a format (or change the one on screen) instead of a workflow
-- draft. The values are added alone: a new enum value cannot be used in the transaction that adds it (the rules are in
-- the next migration).
ALTER TYPE ai_task_kind ADD VALUE 'PDF_FORMAT_DRAFT';
ALTER TYPE ai_task_kind ADD VALUE 'PDF_FORMAT_REVISION';
