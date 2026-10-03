-- A new enum value cannot be used in the transaction that adds it: the rules that use these states are in the next migration.
ALTER TYPE "tenant_status" ADD VALUE 'PENDING_DELETION';
ALTER TYPE "tenant_status" ADD VALUE 'PURGED';
