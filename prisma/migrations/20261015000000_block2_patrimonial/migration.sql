-- CreateEnum
CREATE TYPE "DebtType" AS ENUM ('TARJETA_CREDITO', 'PRESTAMO_PERSONAL', 'CREDITO_AUTOMOTRIZ', 'HIPOTECA', 'CREDITO_NOMINA', 'PRESTAMO_FAMILIAR', 'BNPL', 'DEUDA_NEGOCIO', 'IMPUESTOS', 'OTRA');

-- CreateEnum
CREATE TYPE "SavingDestination" AS ENUM ('FONDO_EMERGENCIA', 'AHORRO');

-- CreateEnum
CREATE TYPE "TaxItemType" AS ENUM ('NEGOCIO', 'INVERSION_FINANCIERA', 'BIEN_INMUEBLE', 'RENTA_ACTIVOS', 'PARTICIPACION_EMPRESA', 'CRIPTOACTIVOS', 'OTRA');

-- CreateEnum
CREATE TYPE "ResultPeriod" AS ENUM ('MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADO');

-- CreateEnum
CREATE TYPE "ScenarioType" AS ENUM ('AHORRO', 'INVERSION', 'META', 'EFECTIVO', 'OTRO');

-- CreateEnum
CREATE TYPE "GoalKind" AS ENUM ('PATRIMONIO', 'AHORRO', 'OTRA');

-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "type" "DebtType" NOT NULL DEFAULT 'OTRA',
ALTER COLUMN "annualRate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DebtBalance" ADD COLUMN     "fees" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "netIncome" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "percent" DECIMAL(7,4) NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyFundPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetMonths" INTEGER NOT NULL,
    "monthlyContribution" DECIMAL(14,2) NOT NULL,
    "declaredEssential" DECIMAL(14,2),
    "useDeclared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyFundPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingContribution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "destination" "SavingDestination" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavingContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxAnalysisItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TaxItemType" NOT NULL,
    "period" "ResultPeriod" NOT NULL,
    "capital" DECIMAL(14,2) NOT NULL,
    "grossProfit" DECIMAL(14,2) NOT NULL,
    "commissions" DECIMAL(14,2) NOT NULL,
    "otherCosts" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(7,4) NOT NULL,
    "sourceAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxAnalysisItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InflationScenario" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ScenarioType" NOT NULL,
    "capital" DECIMAL(14,2) NOT NULL,
    "years" INTEGER NOT NULL,
    "inflationRate" DECIMAL(9,4) NOT NULL,
    "nominalRate" DECIMAL(9,4) NOT NULL,
    "sourceAssetId" TEXT,
    "sourceGoalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InflationScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "GoalKind" NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmount" DECIMAL(14,2) NOT NULL,
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnualReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "complete" BOOLEAN NOT NULL,
    "initialAssets" DECIMAL(14,2),
    "finalAssets" DECIMAL(14,2),
    "initialDebts" DECIMAL(14,2),
    "finalDebts" DECIMAL(14,2),
    "initialNetWorth" DECIMAL(14,2),
    "finalNetWorth" DECIMAL(14,2),
    "variation" DECIMAL(14,2),
    "variationPercent" DECIMAL(12,4),
    "goalAmount" DECIMAL(14,2),
    "goalProgress" DECIMAL(12,4),
    "snapshot" JSONB NOT NULL,
    "driveFileId" TEXT,
    "pdfName" TEXT,
    "pdfMimeType" TEXT,

    CONSTRAINT "AnnualReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnualReviewNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnualReviewNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Budget_userId_year_month_key" ON "Budget"("userId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_budgetId_category_key" ON "BudgetLine"("budgetId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyFundPlan_userId_key" ON "EmergencyFundPlan"("userId");

-- CreateIndex
CREATE INDEX "SavingContribution_userId_periodId_idx" ON "SavingContribution"("userId", "periodId");

-- CreateIndex
CREATE INDEX "TaxAnalysisItem_userId_idx" ON "TaxAnalysisItem"("userId");

-- CreateIndex
CREATE INDEX "InflationScenario_userId_idx" ON "InflationScenario"("userId");

-- CreateIndex
CREATE INDEX "Goal_userId_kind_idx" ON "Goal"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "AnnualReview_userId_periodEnd_key" ON "AnnualReview"("userId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "AnnualReviewNote_userId_periodEnd_key" ON "AnnualReviewNote"("userId", "periodEnd");

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyFundPlan" ADD CONSTRAINT "EmergencyFundPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingContribution" ADD CONSTRAINT "SavingContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingContribution" ADD CONSTRAINT "SavingContribution_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FinancialPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAnalysisItem" ADD CONSTRAINT "TaxAnalysisItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAnalysisItem" ADD CONSTRAINT "TaxAnalysisItem_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InflationScenario" ADD CONSTRAINT "InflationScenario_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InflationScenario" ADD CONSTRAINT "InflationScenario_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InflationScenario" ADD CONSTRAINT "InflationScenario_sourceGoalId_fkey" FOREIGN KEY ("sourceGoalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnualReview" ADD CONSTRAINT "AnnualReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnualReviewNote" ADD CONSTRAINT "AnnualReviewNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


UPDATE "Debt" SET "annualRate" = NULL WHERE "source" = 'M1_DEBT';
