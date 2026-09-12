-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN "priceSnapshot" DECIMAL(10,2);

UPDATE "CartItem" AS ci
SET "priceSnapshot" = pv."price"
FROM "ProductVariant" AS pv
WHERE ci."productVariantId" = pv."id";

ALTER TABLE "CartItem" ALTER COLUMN "priceSnapshot" SET NOT NULL;
