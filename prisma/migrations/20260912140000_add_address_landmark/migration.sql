-- AlterTable
ALTER TABLE "Address" ADD COLUMN "landmark" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "shippingLandmark" TEXT;

UPDATE "Address" SET "addressLine2" = '' WHERE "addressLine2" IS NULL;

UPDATE "Order" SET "shippingLine2" = '' WHERE "shippingLine2" IS NULL;

ALTER TABLE "Address" ALTER COLUMN "addressLine2" SET NOT NULL;

ALTER TABLE "Order" ALTER COLUMN "shippingLine2" SET NOT NULL;
