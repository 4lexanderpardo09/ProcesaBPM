-- Validates the claim-token CHECKs added NOT VALID by 20261017000000. VALIDATE CONSTRAINT scans the table under a lock
-- that lets the outbox keep being read and written (SHARE UPDATE EXCLUSIVE). The constraints hold for every row: the column
-- is NULL everywhere except in the PROCESSING rows, which that migration gave a token.
ALTER TABLE outbox_events VALIDATE CONSTRAINT outbox_claim_token_iff_processing;
ALTER TABLE platform_outbox_events VALIDATE CONSTRAINT platform_outbox_claim_token_iff_processing;
