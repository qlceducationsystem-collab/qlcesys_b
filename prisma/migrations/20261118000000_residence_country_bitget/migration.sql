ALTER TABLE "User" ADD COLUMN "residenceCountry" TEXT;

CREATE TABLE "BitgetReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentAttemptId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "transferredAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "hiddenForClient" BOOLEAN NOT NULL DEFAULT false,
    "hiddenForAdmin" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BitgetReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BitgetEvidence" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BitgetEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BitgetReport_paymentAttemptId_key" ON "BitgetReport"("paymentAttemptId");
CREATE INDEX "BitgetReport_status_createdAt_idx" ON "BitgetReport"("status", "createdAt");
CREATE INDEX "BitgetReport_userId_createdAt_idx" ON "BitgetReport"("userId", "createdAt");
CREATE INDEX "BitgetReport_orderNumber_idx" ON "BitgetReport"("orderNumber");
CREATE UNIQUE INDEX "BitgetReport_orderNumber_active_key" ON "BitgetReport"("orderNumber") WHERE "status" <> 'REJECTED';
CREATE INDEX "BitgetEvidence_reportId_idx" ON "BitgetEvidence"("reportId");

ALTER TABLE "BitgetReport" ADD CONSTRAINT "BitgetReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BitgetReport" ADD CONSTRAINT "BitgetReport_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BitgetEvidence" ADD CONSTRAINT "BitgetEvidence_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "BitgetReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
