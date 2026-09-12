-- CreateEnum
CREATE TYPE "OfferDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateTable
CREATE TABLE "Offer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "discountType" "OfferDiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferProduct" (
    "id" SERIAL NOT NULL,
    "offerId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferCategory" (
    "id" SERIAL NOT NULL,
    "offerId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Offer_isActive_idx" ON "Offer"("isActive");

-- CreateIndex
CREATE INDEX "Offer_startsAt_endsAt_idx" ON "Offer"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "OfferProduct_offerId_idx" ON "OfferProduct"("offerId");

-- CreateIndex
CREATE INDEX "OfferProduct_productId_idx" ON "OfferProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferProduct_offerId_productId_key" ON "OfferProduct"("offerId", "productId");

-- CreateIndex
CREATE INDEX "OfferCategory_offerId_idx" ON "OfferCategory"("offerId");

-- CreateIndex
CREATE INDEX "OfferCategory_categoryId_idx" ON "OfferCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferCategory_offerId_categoryId_key" ON "OfferCategory"("offerId", "categoryId");

-- AddForeignKey
ALTER TABLE "OfferProduct" ADD CONSTRAINT "OfferProduct_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferProduct" ADD CONSTRAINT "OfferProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCategory" ADD CONSTRAINT "OfferCategory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCategory" ADD CONSTRAINT "OfferCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
