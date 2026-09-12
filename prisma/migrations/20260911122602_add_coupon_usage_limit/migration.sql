-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "usageLimit" INTEGER,
ADD COLUMN     "usedCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: every claim already burned counts as a live redemption.
UPDATE "Coupon" AS c
SET "usedCount" = sub.count
FROM (
    SELECT "couponId", COUNT(*)::int AS count
    FROM "CouponClaim"
    WHERE "usedAt" IS NOT NULL
    GROUP BY "couponId"
) AS sub
WHERE c."id" = sub."couponId";

-- usedCount is decremented on release; never let it underflow.
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_usedCount_non_negative" CHECK ("usedCount" >= 0);
