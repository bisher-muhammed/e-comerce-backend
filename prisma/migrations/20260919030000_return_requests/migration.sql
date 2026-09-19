-- H4: returns become an explicit, admin-approved lifecycle.

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'REFUNDED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "returnedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" TEXT NOT NULL,
    "adminNote" TEXT,
    "refundAmount" DECIMAL(10,2),
    "manualRefundReference" TEXT,
    "decidedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnRequest_orderId_idx" ON "ReturnRequest"("orderId");

-- CreateIndex
CREATE INDEX "ReturnRequest_status_createdAt_idx" ON "ReturnRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_orderItemId_idempotencyKey_key" ON "ReturnRequest"("orderItemId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: the delivery time was not recorded before; the last update of
-- a DELIVERED order is the closest available value.
UPDATE "Order" SET "deliveredAt" = "updatedAt"
 WHERE "status" = 'DELIVERED' AND "deliveredAt" IS NULL;

-- Backfill: the old flow marked units "returned" the moment a customer
-- asked, with no refund and no restock. Those units were never verified
-- as received, so they become open REQUESTED returns for an admin to
-- approve/receive (which then restocks and refunds them properly).
INSERT INTO "ReturnRequest"
       ("orderId", "orderItemId", "quantity", "reason", "status",
        "idempotencyKey", "createdAt", "updatedAt")
SELECT oi."orderId",
       oi."id",
       oi."returnedQuantity",
       COALESCE(
         (SELECT a."reason" FROM "OrderItemAction" a
           WHERE a."orderItemId" = oi."id" AND a."type" = 'RETURN'
           ORDER BY a."createdAt" DESC LIMIT 1),
         'Return requested before the return workflow existed'),
       'REQUESTED',
       'legacy-return-migration',
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
  FROM "OrderItem" oi
 WHERE oi."returnedQuantity" > 0;

UPDATE "OrderItem" SET "returnedQuantity" = 0 WHERE "returnedQuantity" > 0;
