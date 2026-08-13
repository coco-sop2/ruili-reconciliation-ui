import { PrismaClient, TaskStatus, ReviewItemStatus, FileKind } from '@prisma/client';
const prisma = new PrismaClient();

// 创建文件记录（不真的落盘，只造元数据）
const sf = await prisma.file.create({ data: { kind: FileKind.SETTLEMENT, originalName: '8月结算.xlsx', contentType: 'xlsx', sizeBytes: 100n, storedPath: '/tmp/fake-settlement.xlsx' } });
const ef = await prisma.file.create({ data: { kind: FileKind.ERP, originalName: '8月ERP.xlsx', contentType: 'xlsx', sizeBytes: 100n, storedPath: '/tmp/fake-erp.xlsx' } });

const task = await prisma.reconciliationTask.create({
  data: {
    status: TaskStatus.NEEDS_REVIEW,
    period: '2026-08',
    version: 1,
    settlementFileId: sf.id,
    erpFileId: ef.id,
    differenceAmount: 25.5,
    completedAt: new Date(),
    reviewItems: {
      create: [
        { label: '运费', differenceAmount: 20, status: ReviewItemStatus.PENDING, payload: { field: '运费', diff: 20 } },
        { label: '手续费', differenceAmount: 5.5, status: ReviewItemStatus.PENDING, payload: { field: '手续费', diff: 5.5 } },
      ],
    },
  },
  include: { reviewItems: true },
});

console.log('测试任务ID:', task.id);
console.log('明细数:', task.reviewItems.length);
for (const i of task.reviewItems) console.log(' -', i.id, i.label, i.status);
console.log('ITEM_ID_1=' + task.reviewItems[0].id);
console.log('ITEM_ID_2=' + task.reviewItems[1].id);
console.log('TASK_ID=' + task.id);
await prisma.$disconnect();
