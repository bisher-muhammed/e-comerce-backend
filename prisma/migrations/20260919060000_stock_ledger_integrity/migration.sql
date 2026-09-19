-- M11: the stock ledger becomes complete and permanent.

-- Movements are history: deleting a variant must not erase them.
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_productVariantId_fkey";

ALTER TABLE "StockMovement" ADD COLUMN     "idempotencyKey" TEXT;

CREATE INDEX "StockMovement_orderItemId_idx" ON "StockMovement"("orderItemId");

CREATE UNIQUE INDEX "StockMovement_productVariantId_idempotencyKey_key" ON "StockMovement"("productVariantId", "idempotencyKey");

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Opening balance: stock changed before the ledger existed (initial stock,
-- product-form edits, partial cancels) is booked once, so that from now on
-- Σ(change) = stock for every variant and any drift is a real anomaly.
INSERT INTO "StockMovement"
       ("productVariantId", "type", "change", "previousStock", "newStock",
        "reason", "idempotencyKey", "createdAt")
SELECT pv."id",
       'MANUAL_ADJUSTMENT',
       pv."stock" - COALESCE(l.total, 0),
       COALESCE(l.total, 0),
       pv."stock",
       'Ledger opening balance (stock changes made before the ledger was complete)',
       'ledger-opening-balance',
       CURRENT_TIMESTAMP
  FROM "ProductVariant" pv
  LEFT JOIN (
        SELECT "productVariantId", SUM("change") AS total
          FROM "StockMovement"
         GROUP BY "productVariantId"
       ) l ON l."productVariantId" = pv."id"
 WHERE pv."stock" <> COALESCE(l.total, 0);
