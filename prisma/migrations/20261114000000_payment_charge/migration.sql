ALTER TABLE "PaymentAttempt" ADD COLUMN "providerPaymentId" TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN "chargedAmount" DECIMAL(14,2);
ALTER TABLE "PaymentAttempt" ADD COLUMN "chargedCurrency" TEXT;
