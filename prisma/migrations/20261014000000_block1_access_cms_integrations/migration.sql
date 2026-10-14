DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Payment") OR EXISTS (SELECT 1 FROM "Subscription") THEN RAISE EXCEPTION 'Subscription/Payment contienen datos: migracion manual requerida'; END IF; END $$;

CREATE TYPE "ProductType" AS ENUM ('RENTA_FIJA', 'RENTA_VARIABLE', 'FONDOS', 'ACCIONES', 'BIENES_RAICES', 'NEGOCIO', 'ACTIVO_DIGITAL', 'LIQUIDEZ');

CREATE TYPE "Horizon" AS ENUM ('CORTO', 'MEDIANO', 'LARGO');

CREATE TYPE "LiquidityLevel" AS ENUM ('ALTA', 'MEDIA', 'BAJA');

CREATE TYPE "PerceivedRisk" AS ENUM ('BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO');

CREATE TYPE "RiskTolerance" AS ENUM ('CONSERVADOR', 'MODERADO', 'ALTO');

CREATE TYPE "FinancialGoal" AS ENUM ('CONSTRUIR_PATRIMONIO', 'FONDO_EMERGENCIA', 'INVERTIR_MEJOR', 'REDUCIR_DEUDAS');

CREATE TYPE "LearningRoute" AS ENUM ('MARKETS', 'PATRIMONIAL');

CREATE TYPE "SimulationKind" AS ENUM ('PORTFOLIO_SIMULATION', 'RISK_EXPOSURE', 'TRADE', 'PROFESSIONAL_OPERATION');

CREATE TYPE "OfferType" AS ENUM ('FULL_ANNUAL', 'TOOL_ONLY');

CREATE TYPE "PaymentAttemptStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE "MediaFileType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

CREATE TYPE "MediaProvider" AS ENUM ('CLOUDINARY', 'GOOGLE_DRIVE');

CREATE TYPE "GoogleService" AS ENUM ('DRIVE', 'GMAIL');

CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'ERROR', 'DISCONNECTED');

CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'FAILED');

ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_userId_fkey";

ALTER TABLE "Payment" DROP CONSTRAINT "Payment_userId_fkey";

ALTER TABLE "Payment" DROP CONSTRAINT "Payment_subscriptionId_fkey";

ALTER TABLE "AdminAuditLog" DROP CONSTRAINT "AdminAuditLog_clientId_fkey";

ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

ALTER TABLE "Income" ADD COLUMN     "source" TEXT;

ALTER TABLE "Expense" ADD COLUMN     "source" TEXT;

ALTER TABLE "ProtectionRecord" ADD COLUMN     "source" TEXT;

ALTER TABLE "Debt" ADD COLUMN     "source" TEXT;

ALTER TABLE "Asset" ADD COLUMN     "horizon" "Horizon",
ADD COLUMN     "liquidityLevel" "LiquidityLevel",
ADD COLUMN     "perceivedRisk" "PerceivedRisk",
ADD COLUMN     "productType" "ProductType",
ADD COLUMN     "source" TEXT;

ALTER TABLE "AdminAuditLog" ALTER COLUMN "clientId" DROP NOT NULL;

DROP TABLE "Subscription";

DROP TABLE "Payment";

DROP TYPE "SubscriptionStatus";

DROP TYPE "PaymentStatus";

CREATE TABLE "FinancialProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthlyInvestment" DECIMAL(14,2) NOT NULL,
    "emergencyFund" DECIMAL(14,2) NOT NULL,
    "declaredCash" DECIMAL(14,2) NOT NULL,
    "declaredInvestments" DECIMAL(14,2) NOT NULL,
    "declaredOtherAssets" DECIMAL(14,2) NOT NULL,
    "riskTolerance" "RiskTolerance" NOT NULL,
    "mainGoal" "FinancialGoal" NOT NULL,
    "diagnosedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModuleSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleNumber" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EducationalSimulation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleNumber" INTEGER NOT NULL,
    "kind" "SimulationKind" NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EducationalSimulation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "route" "LearningRoute",
    "routeChosenAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketRouteAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "tradingScore" INTEGER NOT NULL,
    "exchangeScore" INTEGER NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketRouteAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductOffer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "OfferType" NOT NULL,
    "moduleNumber" INTEGER,
    "price" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "accessDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "currency" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccessGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "paymentAttemptId" TEXT,
    "accessType" "OfferType" NOT NULL,
    "moduleNumber" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "secureUrl" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "format" TEXT,
    "resourceType" TEXT NOT NULL,
    "bytes" INTEGER,
    "purpose" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicSection" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "navLabel" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "eyebrow" TEXT,
    "title" TEXT NOT NULL,
    "highlight" TEXT,
    "subtitle" TEXT,
    "description" TEXT,
    "secondaryText" TEXT,
    "primaryCtaLabel" TEXT,
    "primaryCtaTarget" TEXT,
    "secondaryCtaLabel" TEXT,
    "secondaryCtaTarget" TEXT,
    "items" JSONB,
    "imageId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicSection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModuleMedia" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "fileType" "MediaFileType" NOT NULL,
    "provider" "MediaProvider" NOT NULL,
    "providerFileId" TEXT NOT NULL,
    "url" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleMedia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleIntegration" (
    "id" TEXT NOT NULL,
    "service" "GoogleService" NOT NULL,
    "email" TEXT,
    "encryptedRefreshToken" TEXT,
    "scopes" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "connectedAt" TIMESTAMP(3),
    "connectedById" TEXT,
    "lastError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "driveFolders" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "path" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinancialProfile_userId_key" ON "FinancialProfile"("userId");

CREATE INDEX "ModuleSubmission_userId_moduleNumber_idx" ON "ModuleSubmission"("userId", "moduleNumber");

CREATE INDEX "EducationalSimulation_userId_moduleNumber_idx" ON "EducationalSimulation"("userId", "moduleNumber");

CREATE UNIQUE INDEX "LearningState_userId_key" ON "LearningState"("userId");

CREATE INDEX "MarketRouteAssessment_userId_createdAt_idx" ON "MarketRouteAssessment"("userId", "createdAt");

CREATE UNIQUE INDEX "ProductOffer_code_key" ON "ProductOffer"("code");

CREATE UNIQUE INDEX "PaymentAttempt_providerRef_key" ON "PaymentAttempt"("providerRef");

CREATE INDEX "PaymentAttempt_userId_createdAt_idx" ON "PaymentAttempt"("userId", "createdAt");

CREATE INDEX "PaymentAttempt_status_createdAt_idx" ON "PaymentAttempt"("status", "createdAt");

CREATE UNIQUE INDEX "AccessGrant_paymentAttemptId_key" ON "AccessGrant"("paymentAttemptId");

CREATE INDEX "AccessGrant_userId_active_idx" ON "AccessGrant"("userId", "active");

CREATE UNIQUE INDEX "MediaAsset_publicId_key" ON "MediaAsset"("publicId");

CREATE UNIQUE INDEX "PublicSection_key_key" ON "PublicSection"("key");

CREATE INDEX "ModuleMedia_moduleId_position_idx" ON "ModuleMedia"("moduleId", "position");

CREATE UNIQUE INDEX "GoogleIntegration_service_key" ON "GoogleIntegration"("service");

CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");

CREATE INDEX "AnalyticsEvent_event_createdAt_idx" ON "AnalyticsEvent"("event", "createdAt");

CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

CREATE INDEX "Income_periodId_source_idx" ON "Income"("periodId", "source");

CREATE INDEX "Expense_periodId_source_idx" ON "Expense"("periodId", "source");

CREATE INDEX "Asset_userId_source_idx" ON "Asset"("userId", "source");

ALTER TABLE "FinancialProfile" ADD CONSTRAINT "FinancialProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModuleSubmission" ADD CONSTRAINT "ModuleSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EducationalSimulation" ADD CONSTRAINT "EducationalSimulation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningState" ADD CONSTRAINT "LearningState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketRouteAssessment" ADD CONSTRAINT "MarketRouteAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ProductOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ProductOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PublicSection" ADD CONSTRAINT "PublicSection_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModuleMedia" ADD CONSTRAINT "ModuleMedia_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "AcademyModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

