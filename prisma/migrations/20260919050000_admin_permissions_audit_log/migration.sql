-- M9: per-admin permissions and an audit trail of admin actions.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Existing admins keep exactly what they could do before (every grantable
-- permission); a SUPER_ADMIN narrows them from the admin portal.
UPDATE "User"
   SET "permissions" = ARRAY[
     'orders.read', 'orders.update', 'orders.cancel', 'orders.refund',
     'returns.manage', 'catalog.read', 'catalog.write', 'stock.write',
     'coupons.read', 'coupons.write', 'offers.read', 'offers.write',
     'customers.read', 'customers.suspend', 'stats.view', 'audit.view'
   ]::TEXT[]
 WHERE "role" = 'ADMIN';

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER,
    "actorEmail" TEXT NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "statusCode" INTEGER NOT NULL,
    "requestData" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
