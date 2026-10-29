ALTER TYPE "ProtectionType" ADD VALUE IF NOT EXISTS 'SEGURO_AUTO';
ALTER TYPE "ProtectionType" ADD VALUE IF NOT EXISTS 'SEGURO_DESEMPLEO';
ALTER TYPE "ProtectionType" ADD VALUE IF NOT EXISTS 'SEGURO_EDUCACION';
ALTER TABLE "ProtectionRecord" ADD COLUMN "insurer" TEXT;
ALTER TABLE "ProtectionRecord" ADD COLUMN "policyNumber" TEXT;
ALTER TABLE "ProtectionRecord" ADD COLUMN "claimsNumber" TEXT;
ALTER TABLE "ProtectionRecord" ADD COLUMN "policyFileId" TEXT;
ALTER TABLE "ProtectionRecord" ADD COLUMN "policyFileName" TEXT;
ALTER TABLE "ProtectionRecord" ADD COLUMN "policyFileFormat" TEXT;
