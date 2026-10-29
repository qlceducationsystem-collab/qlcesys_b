ALTER TABLE "Asset" ADD COLUMN "incomeTerm" INTEGER;
ALTER TABLE "Asset" ADD COLUMN "incomeStart" TIMESTAMP(3);
ALTER TABLE "DebtBalance" ADD COLUMN "paymentExpenseId" TEXT;
ALTER TABLE "DebtBalance" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "DebtBalance" ADD COLUMN "balanceBeforePayment" DECIMAL(14,2);
