/*
  Warnings:

  - You are about to drop the `Offer` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('ORDER_PLACED', 'ORDER_CANCELLED', 'ORDER_RETURNED', 'MANUAL_ADJUSTMENT', 'RESTOCK');

-- DropForeignKey
ALTER TABLE "Offer" DROP CONSTRAINT "Offer_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Offer" DROP CONSTRAINT "Offer_productId_fkey";

-- DropTable
DROP TABLE "Offer";

-- DropEnum
DROP TYPE "OfferType";

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
