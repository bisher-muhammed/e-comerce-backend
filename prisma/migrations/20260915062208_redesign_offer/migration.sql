/*
  Warnings:

  - You are about to drop the column `discountType` on the `Offer` table. All the data in the column will be lost.
  - You are about to drop the column `discountValue` on the `Offer` table. All the data in the column will be lost.
  - You are about to drop the column `endsAt` on the `Offer` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Offer` table. All the data in the column will be lost.
  - You are about to drop the column `startsAt` on the `Offer` table. All the data in the column will be lost.
  - You are about to drop the `OfferCategory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OfferProduct` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `discountPercentage` to the `Offer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `expiresOn` to the `Offer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startsOn` to the `Offer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `Offer` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('PRODUCT', 'CATEGORY');

-- DropForeignKey
ALTER TABLE "OfferCategory" DROP CONSTRAINT "OfferCategory_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "OfferCategory" DROP CONSTRAINT "OfferCategory_offerId_fkey";

-- DropForeignKey
ALTER TABLE "OfferProduct" DROP CONSTRAINT "OfferProduct_offerId_fkey";

-- DropForeignKey
ALTER TABLE "OfferProduct" DROP CONSTRAINT "OfferProduct_productId_fkey";

-- DropIndex
DROP INDEX "Offer_isActive_idx";

-- DropIndex
DROP INDEX "Offer_startsAt_endsAt_idx";

-- AlterTable
ALTER TABLE "Offer" DROP COLUMN "discountType",
DROP COLUMN "discountValue",
DROP COLUMN "endsAt",
DROP COLUMN "name",
DROP COLUMN "startsAt",
ADD COLUMN     "categoryId" INTEGER,
ADD COLUMN     "discountPercentage" DECIMAL(5,2) NOT NULL,
ADD COLUMN     "expiresOn" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "productId" INTEGER,
ADD COLUMN     "startsOn" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "type" "OfferType" NOT NULL;

-- DropTable
DROP TABLE "OfferCategory";

-- DropTable
DROP TABLE "OfferProduct";

-- DropEnum
DROP TYPE "OfferDiscountType";

-- CreateIndex
CREATE INDEX "Offer_productId_idx" ON "Offer"("productId");

-- CreateIndex
CREATE INDEX "Offer_categoryId_idx" ON "Offer"("categoryId");

-- CreateIndex
CREATE INDEX "Offer_isActive_startsOn_expiresOn_idx" ON "Offer"("isActive", "startsOn", "expiresOn");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
