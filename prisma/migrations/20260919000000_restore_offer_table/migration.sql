-- Repairs environments that applied the original 20260918040721_stock_flow,
-- which dropped "Offer" and "OfferType" (audit C1). Every statement is
-- conditional, so this is a no-op on databases where the table survived
-- (including every fresh database, since stock_flow no longer drops it).
--
-- Rows deleted by the original migration are NOT recovered here; restore
-- them from a backup taken before that deploy.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OfferType') THEN
    CREATE TYPE "OfferType" AS ENUM ('PRODUCT', 'CATEGORY');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "Offer" (
    "id" SERIAL NOT NULL,
    "type" "OfferType" NOT NULL,
    "productId" INTEGER,
    "categoryId" INTEGER,
    "discountPercentage" DECIMAL(5,2) NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "expiresOn" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Offer_productId_idx" ON "Offer"("productId");
CREATE INDEX IF NOT EXISTS "Offer_categoryId_idx" ON "Offer"("categoryId");
CREATE INDEX IF NOT EXISTS "Offer_isActive_startsOn_expiresOn_idx" ON "Offer"("isActive", "startsOn", "expiresOn");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Offer_productId_fkey') THEN
    ALTER TABLE "Offer" ADD CONSTRAINT "Offer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Offer_categoryId_fkey') THEN
    ALTER TABLE "Offer" ADD CONSTRAINT "Offer_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
