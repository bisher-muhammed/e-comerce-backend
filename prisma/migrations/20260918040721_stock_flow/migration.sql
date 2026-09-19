-- NOTE: this migration was originally generated from a branch whose
-- schema.prisma was missing the Offer model, so Prisma emitted
-- `DROP TABLE "Offer"` / `DROP TYPE "OfferType"` here. Those statements
-- were removed before release (audit C1). Any environment that already
-- applied the original version is repaired by the forward migration
-- 20260919000000_restore_offer_table; `prisma migrate deploy` will print
-- a "modified since applied" warning for this file there, which is
-- expected.

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('ORDER_PLACED', 'ORDER_CANCELLED', 'ORDER_RETURNED', 'MANUAL_ADJUSTMENT', 'RESTOCK');

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" SERIAL NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "change" INTEGER NOT NULL,
    "previousStock" INTEGER NOT NULL,
    "newStock" INTEGER NOT NULL,
    "orderItemId" INTEGER,
    "reason" TEXT,
    "supplierName" TEXT,
    "unitCost" DECIMAL(10,2),
    "batchNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovement_productVariantId_createdAt_idx" ON "StockMovement"("productVariantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
