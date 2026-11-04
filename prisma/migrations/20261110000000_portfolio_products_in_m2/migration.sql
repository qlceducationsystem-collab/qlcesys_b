ALTER TABLE "Asset" ADD COLUMN "breakdown" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Debt" ADD COLUMN "customType" TEXT;

UPDATE "Asset" a SET
  "productType" = (CASE c."code"
    WHEN 'RENTA_FIJA' THEN 'RENTA_FIJA'
    WHEN 'RENTA_VARIABLE' THEN 'RENTA_VARIABLE'
    WHEN 'BIENES_RAICES' THEN 'BIENES_RAICES'
    WHEN 'NEGOCIOS' THEN 'NEGOCIO'
    WHEN 'ACTIVOS_DIGITALES' THEN 'ACTIVO_DIGITAL'
    WHEN 'ALTO_RIESGO' THEN 'ALTO_RIESGO'
    WHEN 'LIQUIDEZ' THEN 'LIQUIDEZ'
  END)::"ProductType",
  "horizon" = COALESCE(a."horizon", 'MEDIANO'::"Horizon"),
  "liquidityLevel" = COALESCE(a."liquidityLevel", 'MEDIA'::"LiquidityLevel"),
  "perceivedRisk" = COALESCE(a."perceivedRisk", 'MEDIO'::"PerceivedRisk"),
  "breakdown" = false
FROM "AssetCategory" c
WHERE a."categoryId" = c."id" AND a."productType" IS NULL AND a."source" IS NULL
  AND c."code" IN ('RENTA_FIJA', 'RENTA_VARIABLE', 'BIENES_RAICES', 'NEGOCIOS', 'ACTIVOS_DIGITALES', 'ALTO_RIESGO', 'LIQUIDEZ');
