-- H2: refund reconciliation and retry.

-- DropIndex
DROP INDEX "Refund_status_idx";

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "orphanPayment" BOOLEAN NOT NULL DEFAULT false;

-- Refunds of captures that arrived after the order stopped accepting
-- payment were created by the webhook with this key prefix.
UPDATE "Refund" SET "orphanPayment" = true
 WHERE "idempotencyKey" LIKE 'webhook-orphan:%';

-- CreateIndex
CREATE INDEX "Refund_status_updatedAt_idx" ON "Refund"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Refund_razorpayPaymentId_idx" ON "Refund"("razorpayPaymentId");
