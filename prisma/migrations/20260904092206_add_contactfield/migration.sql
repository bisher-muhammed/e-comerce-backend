-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_status_paymentStatus_expiresAt_idx" ON "Order"("status", "paymentStatus", "expiresAt");
