-- Step 1: add nullable/defaulted columns first
ALTER TABLE "OrderItem" ADD COLUMN "remainingQuantity" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "cancelledQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "returnedQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Step 2: backfill from existing data
UPDATE "OrderItem" SET "remainingQuantity" = "quantity" WHERE "remainingQuantity" IS NULL;
UPDATE "OrderItem" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- Step 3: now enforce NOT NULL + set the ongoing default for updatedAt
ALTER TABLE "OrderItem" ALTER COLUMN "remainingQuantity" SET NOT NULL;
ALTER TABLE "OrderItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "OrderItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Step 4: new action table
CREATE TYPE "OrderItemActionType" AS ENUM ('CANCEL', 'RETURN');

CREATE TABLE "OrderItemAction" (
    "id" SERIAL NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "type" "OrderItemActionType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderItemAction_orderItemId_idempotencyKey_key" ON "OrderItemAction"("orderItemId", "idempotencyKey");
CREATE INDEX "OrderItemAction_orderItemId_idx" ON "OrderItemAction"("orderItemId");

ALTER TABLE "OrderItemAction" ADD CONSTRAINT "OrderItemAction_orderItemId_fkey"
    FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    