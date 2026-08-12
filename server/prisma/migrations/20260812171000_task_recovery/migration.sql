ALTER TABLE "reconciliation_tasks"
ADD COLUMN "agentName" TEXT,
ADD COLUMN "agentWorkspace" TEXT,
ADD COLUMN "agentId" TEXT,
ADD COLUMN "agentSessionId" TEXT,
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
