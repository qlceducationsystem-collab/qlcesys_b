ALTER TYPE "FinancialGoal" ADD VALUE IF NOT EXISTS 'OTRO';
ALTER TABLE "FinancialProfile" ADD COLUMN "mainGoalCustom" TEXT;
