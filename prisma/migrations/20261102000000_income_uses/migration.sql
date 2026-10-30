CREATE TABLE "IncomeUse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "category" TEXT,
    "expenseId" TEXT,
    "outMovementId" TEXT,
    "inMovementId" TEXT,
    "targetPositionId" TEXT,
    "createdTarget" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IncomeUse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncomeUse_userId_periodId_idx" ON "IncomeUse"("userId", "periodId");
CREATE INDEX "IncomeUse_expenseId_idx" ON "IncomeUse"("expenseId");
CREATE INDEX "IncomeUse_outMovementId_idx" ON "IncomeUse"("outMovementId");
CREATE INDEX "IncomeUse_inMovementId_idx" ON "IncomeUse"("inMovementId");

ALTER TABLE "IncomeUse" ADD CONSTRAINT "IncomeUse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncomeUse" ADD CONSTRAINT "IncomeUse_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FinancialPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "IncomeUse" ("id", "userId", "periodId", "positionId", "origin", "kind", "amount", "category", "expenseId", "outMovementId")
SELECT 'iu_' || e."id", e."userId", e."periodId",
       split_part(substring(e."source" from 12), ':', 1), 'MONTH', 'EXPENSE', e."amount", e."category"::text, e."id",
       split_part(substring(e."source" from 12), ':', 2)
FROM "Expense" e
WHERE e."source" LIKE 'INCOME\_USE:%';
