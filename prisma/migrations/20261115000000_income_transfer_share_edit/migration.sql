ALTER TABLE "DataShare" ADD COLUMN "allowEdit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DataShare" ADD COLUMN "editGrantedAt" TIMESTAMP(3);
ALTER TABLE "IncomeUse" ADD COLUMN "incomeId" TEXT;
CREATE INDEX "IncomeUse_incomeId_idx" ON "IncomeUse"("incomeId");
