-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'SHIPPED';

-- DropIndex
DROP INDEX "Order_idempotencyKey_key";

-- DropIndex
DROP INDEX "Order_userId_idx";

-- DropIndex
DROP INDEX "Product_isActive_idx";

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_idempotencyKey_key" ON "Order"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderItem_productVariantId_idx" ON "OrderItem"("productVariantId");

-- CreateIndex
CREATE INDEX "Product_isActive_createdAt_idx" ON "Product"("isActive", "createdAt");

-- CreateIndex
CREATE INDEX "Product_createdAt_idx" ON "Product"("createdAt");
