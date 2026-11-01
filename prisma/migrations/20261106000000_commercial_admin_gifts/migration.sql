ALTER TABLE "User" ADD COLUMN "marketingOptOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "subscriptionCancelledAt" TIMESTAMP(3);

ALTER TABLE "ProductOffer" ADD COLUMN "giftable" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "PaymentAttempt" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "PaymentAttempt" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PaymentAttempt" ADD COLUMN "promotionId" TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN "authorization" TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN "authorizedAt" TIMESTAMP(3);
ALTER TABLE "PaymentAttempt" ADD COLUMN "authorizedById" TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN "giftMessage" TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN "giftRecipientName" TEXT;
CREATE UNIQUE INDEX "PaymentAttempt_promotionId_key" ON "PaymentAttempt"("promotionId");

ALTER TABLE "AccessGrant" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'PAGO';
ALTER TABLE "AccessGrant" ADD COLUMN "reason" TEXT;
ALTER TABLE "AccessGrant" ADD COLUMN "grantedById" TEXT;
ALTER TABLE "AccessGrant" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "AccessGrant" ADD COLUMN "revokedById" TEXT;
ALTER TABLE "AccessGrant" ADD COLUMN "expiryNotifiedAt" TIMESTAMP(3);
UPDATE "AccessGrant" SET "source" = 'MANUAL' WHERE "paymentAttemptId" IS NULL;
UPDATE "AccessGrant" SET "expiryNotifiedAt" = CURRENT_TIMESTAMP WHERE "expiresAt" IS NOT NULL AND "expiresAt" <= CURRENT_TIMESTAMP;

CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVA',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "emailedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");
CREATE INDEX "Promotion_userId_status_idx" ON "Promotion"("userId", "status");
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ProductOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "GiftCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "purchaserId" TEXT NOT NULL,
    "paymentAttemptId" TEXT NOT NULL,
    "recipientId" TEXT,
    "recipientName" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISPONIBLE',
    "redeemBy" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "grantId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GiftCode_code_key" ON "GiftCode"("code");
CREATE UNIQUE INDEX "GiftCode_grantId_key" ON "GiftCode"("grantId");
CREATE INDEX "GiftCode_purchaserId_idx" ON "GiftCode"("purchaserId");
CREATE INDEX "GiftCode_status_idx" ON "GiftCode"("status");
ALTER TABLE "GiftCode" ADD CONSTRAINT "GiftCode_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ProductOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCode" ADD CONSTRAINT "GiftCode_purchaserId_fkey" FOREIGN KEY ("purchaserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftCode" ADD CONSTRAINT "GiftCode_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftCode" ADD CONSTRAINT "GiftCode_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftCode" ADD CONSTRAINT "GiftCode_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "AccessGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AdminEvent" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "userEmail" TEXT,
    "product" TEXT,
    "period" TEXT,
    "status" TEXT,
    "amount" DECIMAL(14,2),
    "result" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminEvent_createdAt_idx" ON "AdminEvent"("createdAt");
CREATE INDEX "AdminEvent_userId_createdAt_idx" ON "AdminEvent"("userId", "createdAt");
CREATE INDEX "AdminEvent_category_createdAt_idx" ON "AdminEvent"("category", "createdAt");

CREATE TABLE "MasterKey" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MasterKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
