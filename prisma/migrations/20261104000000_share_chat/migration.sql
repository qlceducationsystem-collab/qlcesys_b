CREATE TABLE "ShareMessage" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShareMessage_shareId_createdAt_idx" ON "ShareMessage"("shareId", "createdAt");

ALTER TABLE "ShareMessage" ADD CONSTRAINT "ShareMessage_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "DataShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
