CREATE TABLE "DataShare" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "endedByRole" TEXT,
    CONSTRAINT "DataShare_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataShare_clientId_endedAt_idx" ON "DataShare"("clientId", "endedAt");

ALTER TABLE "DataShare" ADD CONSTRAINT "DataShare_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
