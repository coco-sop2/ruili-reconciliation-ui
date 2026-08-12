-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'NEEDS_REVIEW', 'REVIEWED', 'FAILED', 'OBSOLETE');

-- CreateEnum
CREATE TYPE "ReviewItemStatus" AS ENUM ('PENDING', 'APPROVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('SETTLEMENT', 'ERP');

-- CreateTable
CREATE TABLE "reconciliation_tasks" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "TaskStatus" NOT NULL,
    "period" TEXT,
    "periodRaw" TEXT,
    "settlementFileId" TEXT NOT NULL,
    "erpFileId" TEXT NOT NULL,
    "settlementAmount" DECIMAL(14,2),
    "erpAmount" DECIMAL(14,2),
    "differenceAmount" DECIMAL(14,2),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "rawAgentPayload" JSONB,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "reconciliation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_review_items" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "differenceAmount" DECIMAL(14,2),
    "status" "ReviewItemStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "reconciliation_review_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_tasks_settlementFileId_key" ON "reconciliation_tasks"("settlementFileId");
CREATE UNIQUE INDEX "reconciliation_tasks_erpFileId_key" ON "reconciliation_tasks"("erpFileId");
CREATE INDEX "reconciliation_tasks_status_idx" ON "reconciliation_tasks"("status");
CREATE INDEX "reconciliation_tasks_period_idx" ON "reconciliation_tasks"("period");
CREATE INDEX "reconciliation_tasks_createdAt_idx" ON "reconciliation_tasks"("createdAt");
CREATE UNIQUE INDEX "reconciliation_tasks_period_version_key" ON "reconciliation_tasks"("period", "version");
CREATE INDEX "reconciliation_review_items_taskId_idx" ON "reconciliation_review_items"("taskId");

-- AddForeignKey
ALTER TABLE "reconciliation_tasks" ADD CONSTRAINT "reconciliation_tasks_settlementFileId_fkey" FOREIGN KEY ("settlementFileId") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_tasks" ADD CONSTRAINT "reconciliation_tasks_erpFileId_fkey" FOREIGN KEY ("erpFileId") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_review_items" ADD CONSTRAINT "reconciliation_review_items_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "reconciliation_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
