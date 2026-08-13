-- Historical tasks were incorrectly marked OBSOLETE solely because another task shared their period.
UPDATE "reconciliation_tasks" AS task
SET
  "status" = CASE
    WHEN task."rawAgentPayload"->>'matched' = 'true' THEN 'SUCCEEDED'::"TaskStatus"
    WHEN NOT EXISTS (
      SELECT 1
      FROM "reconciliation_review_items" AS item
      WHERE item."taskId" = task."id"
        AND item."status" = 'PENDING'::"ReviewItemStatus"
    ) THEN 'REVIEWED'::"TaskStatus"
    ELSE 'NEEDS_REVIEW'::"TaskStatus"
  END,
  "resolvedAt" = CASE
    WHEN task."rawAgentPayload"->>'matched' = 'true' THEN task."resolvedAt"
    WHEN NOT EXISTS (
      SELECT 1
      FROM "reconciliation_review_items" AS item
      WHERE item."taskId" = task."id"
        AND item."status" = 'PENDING'::"ReviewItemStatus"
    ) THEN COALESCE(task."resolvedAt", task."completedAt")
    ELSE NULL
  END
WHERE task."status" = 'OBSOLETE'::"TaskStatus"
  AND task."rawAgentPayload" IS NOT NULL
  AND jsonb_typeof(task."rawAgentPayload") = 'object';
