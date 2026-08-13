ALTER TABLE "reconciliation_tasks"
ADD COLUMN "name" VARCHAR(120);

UPDATE "reconciliation_tasks"
SET "name" = LEFT(NULLIF(BTRIM("rawAgentPayload"->>'name'), ''), 120)
WHERE "rawAgentPayload" IS NOT NULL
  AND jsonb_typeof("rawAgentPayload") = 'object';
