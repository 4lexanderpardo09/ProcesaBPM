-- PDF documents: workflow documents without a moment (produced only by a DOCUMENT block), template and format shape
-- rules, and the guarantees for generated documents. See docs/base-de-datos.md §8.18.

-- 1. A NULL moment means "only when a DOCUMENT block asks for it"; a workflow has one active document per moment and company.
ALTER TABLE workflow_documents ALTER COLUMN moment DROP NOT NULL;
CREATE UNIQUE INDEX workflow_documents_one_active_moment ON workflow_documents (tenant_id, workflow_id, company_id, moment)
  NULLS NOT DISTINCT WHERE is_active AND moment IS NOT NULL;

-- The format or template a workflow document points at belongs to the same workflow (and company, for templates).
CREATE FUNCTION trg_workflow_document_same_workflow() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_workflow uuid;
    v_company uuid;
  BEGIN
    IF NEW.format_id IS NOT NULL THEN
      SELECT workflow_id INTO v_workflow FROM pdf_formats WHERE tenant_id = NEW.tenant_id AND id = NEW.format_id;
      IF v_workflow IS DISTINCT FROM NEW.workflow_id THEN
        RAISE EXCEPTION 'the format belongs to another workflow' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.template_id IS NOT NULL THEN
      SELECT workflow_id, company_id INTO v_workflow, v_company FROM pdf_templates WHERE tenant_id = NEW.tenant_id AND id = NEW.template_id;
      IF v_workflow IS DISTINCT FROM NEW.workflow_id THEN
        RAISE EXCEPTION 'the template belongs to another workflow' USING ERRCODE = '23514';
      END IF;
      IF v_company IS NOT NULL AND v_company IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'the template belongs to another company' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER workflow_documents_same_workflow BEFORE INSERT OR UPDATE ON workflow_documents
  FOR EACH ROW EXECUTE FUNCTION trg_workflow_document_same_workflow();

-- 2. Templates and formats
ALTER TABLE pdf_templates ADD COLUMN acroform_fields jsonb NOT NULL DEFAULT '[]';
ALTER TABLE pdf_templates ADD COLUMN updated_at timestamptz(3) NOT NULL DEFAULT now();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pdf_templates FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
ALTER TABLE pdf_templates ADD CONSTRAINT pdf_templates_pages_array CHECK (jsonb_typeof(pages) = 'array' AND jsonb_array_length(pages) BETWEEN 1 AND 50);
ALTER TABLE pdf_formats ADD CONSTRAINT pdf_formats_design_object CHECK (jsonb_typeof(design) = 'object');

ALTER TABLE pdf_template_fields ADD CONSTRAINT pdf_template_fields_geometry CHECK (
  (page IS NULL OR page >= 1) AND (x IS NULL OR x >= 0) AND (y IS NULL OR y >= 0)
  AND (font_size IS NULL OR font_size BETWEEN 4 AND 72) AND (max_width IS NULL OR max_width > 0)
  AND (align IS NULL OR align IN ('LEFT', 'CENTER', 'RIGHT')));
ALTER TABLE pdf_template_signatures ADD CONSTRAINT pdf_template_signatures_box CHECK (
  mode <> 'COORDINATES' OR (width > 0 AND height > 0 AND page >= 1 AND x IS NOT NULL AND y IS NOT NULL));

-- 3. Generated documents
-- A generated file is the document of one version, never of two.
CREATE UNIQUE INDEX ticket_documents_generated_once ON ticket_documents (tenant_id, file_id) WHERE role IN ('MAIN_DOCUMENT', 'STEP_DOCUMENT');
ALTER TABLE ticket_documents ADD CONSTRAINT ticket_documents_step_role CHECK (
  (role <> 'STEP_DOCUMENT' OR step_id IS NOT NULL) AND (role <> 'MAIN_DOCUMENT' OR step_id IS NULL));
-- System files are made by the platform: nobody uploaded them, and they stay under 50 MB.
ALTER TABLE stored_files ADD CONSTRAINT stored_files_system_shape CHECK (origin <> 'SYSTEM' OR (uploaded_by_id IS NULL AND size_bytes <= 52428800));
