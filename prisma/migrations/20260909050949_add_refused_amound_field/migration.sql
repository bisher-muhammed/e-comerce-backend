-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelledAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
