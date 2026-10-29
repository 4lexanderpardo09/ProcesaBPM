-- E-mail policy of notifications (docs/base-de-datos.md §8.35): per organization and notification type, an administrator
-- decides whether the type is never mailed (OFF), mailed only to whoever asks (DEFAULT_OFF) or mailed unless the person
-- declines (DEFAULT_ON). No row keeps the type's built-in default. The API writes it as an administrator (audited); the
-- worker reads it again before every e-mail. Plain tenant table: FORCE RLS like the rest.
-- The FK takes a SHARE ROW EXCLUSIVE lock on tenants: do not wait behind a long transaction.

SET LOCAL lock_timeout = '10s';

-- CreateEnum
CREATE TYPE "notification_email_policy" AS ENUM ('OFF', 'DEFAULT_OFF', 'DEFAULT_ON');

-- CreateTable
CREATE TABLE "notification_email_policies" (
    "tenant_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "policy" "notification_email_policy" NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_email_policies_pkey" PRIMARY KEY ("tenant_id","type")
);

-- AddForeignKey
ALTER TABLE "notification_email_policies" ADD CONSTRAINT "notification_email_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

SELECT app_enable_tenant_rls('notification_email_policies');

CREATE TRIGGER set_updated_at BEFORE UPDATE ON notification_email_policies FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
