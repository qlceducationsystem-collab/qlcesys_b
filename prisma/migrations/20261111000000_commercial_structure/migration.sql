ALTER TYPE "OfferType" ADD VALUE IF NOT EXISTS 'CONSULTA';
ALTER TYPE "OfferType" ADD VALUE IF NOT EXISTS 'ORIENTACION';

ALTER TABLE "User" ADD COLUMN "retentionStage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductOffer" ADD COLUMN "sessions" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ServiceCredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "paymentAttemptId" TEXT,
    "grantId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usedRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceCredit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServiceCredit_userId_kind_usedAt_idx" ON "ServiceCredit"("userId", "kind", "usedAt");
CREATE INDEX "ServiceCredit_usedRef_idx" ON "ServiceCredit"("usedRef");
ALTER TABLE "ServiceCredit" ADD CONSTRAINT "ServiceCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ModuleQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleNumber" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answeredById" TEXT,
    "creditId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModuleQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModuleQuestion_userId_moduleNumber_idx" ON "ModuleQuestion"("userId", "moduleNumber");
CREATE INDEX "ModuleQuestion_answeredAt_idx" ON "ModuleQuestion"("answeredAt");
ALTER TABLE "ModuleQuestion" ADD CONSTRAINT "ModuleQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MasterclassProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleNumber" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MasterclassProgress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MasterclassProgress_userId_moduleNumber_key" ON "MasterclassProgress"("userId", "moduleNumber");
ALTER TABLE "MasterclassProgress" ADD CONSTRAINT "MasterclassProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
