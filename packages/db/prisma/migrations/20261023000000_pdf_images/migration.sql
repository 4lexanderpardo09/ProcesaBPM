-- Images of the PDF formats (docs/base-de-datos.md §8.18): a seal, a banner, a stamp that a workflow's canvas formats show.
--   * pdf_images: one row per image, per workflow. The file is referenced, never linked (linked_at stays NULL): deleting
--     the row frees the upload, and the stale-upload purge removes it once nothing else refers to it.
-- The FKs take a SHARE ROW EXCLUSIVE lock on workflows and stored_files: do not wait behind a long transaction.

SET LOCAL lock_timeout = '10s';

-- CreateTable
CREATE TABLE "pdf_images" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workflow_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_images_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateIndex
CREATE INDEX "pdf_images_tenant_id_workflow_id_idx" ON "pdf_images"("tenant_id", "workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "pdf_images_tenant_id_file_id_key" ON "pdf_images"("tenant_id", "file_id");

-- AddForeignKey
ALTER TABLE "pdf_images" ADD CONSTRAINT "pdf_images_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_images" ADD CONSTRAINT "pdf_images_tenant_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_images" ADD CONSTRAINT "pdf_images_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "stored_files"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma does not express
-- ---------------------------------------------------------------------------
ALTER TABLE pdf_images ADD CONSTRAINT pdf_images_name_length CHECK (char_length(name) BETWEEN 1 AND 200);

SELECT app_enable_tenant_rls('pdf_images');
