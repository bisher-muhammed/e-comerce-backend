CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Order_contactEmail_idx" ON "Order" USING GIN ("contactEmail" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Order_contactPhone_idx" ON "Order" USING GIN ("contactPhone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "OrderItem_productName_idx" ON "OrderItem" USING GIN ("productName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User" USING GIN ("email" gin_trgm_ops);
