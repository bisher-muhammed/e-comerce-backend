-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "couponDiscount" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" "CouponDiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "minimumOrderAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "maximumDiscountAmount" DECIMAL(10,2),
    "startsOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponClaim" (
    "id" SERIAL NOT NULL,
    "couponId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "orderId" INTEGER,

    CONSTRAINT "CouponClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_isActive_idx" ON "Coupon"("isActive");

-- CreateIndex
CREATE INDEX "Coupon_startsOn_expiresOn_idx" ON "Coupon"("startsOn", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "CouponClaim_orderId_key" ON "CouponClaim"("orderId");

-- CreateIndex
CREATE INDEX "CouponClaim_userId_idx" ON "CouponClaim"("userId");

-- CreateIndex
CREATE INDEX "CouponClaim_couponId_idx" ON "CouponClaim"("couponId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponClaim_couponId_userId_key" ON "CouponClaim"("couponId", "userId");

-- AddForeignKey
ALTER TABLE "CouponClaim" ADD CONSTRAINT "CouponClaim_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponClaim" ADD CONSTRAINT "CouponClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponClaim" ADD CONSTRAINT "CouponClaim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
