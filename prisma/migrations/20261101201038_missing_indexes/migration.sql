-- DropIndex
DROP INDEX "onion_lot_lotNumber_idx";

-- CreateIndex
CREATE INDEX "machine_assignment_workOrderId_status_idx" ON "machine_assignment"("workOrderId", "status");

-- CreateIndex
CREATE INDEX "onion_shipment_item_shipmentId_idx" ON "onion_shipment_item"("shipmentId");

-- CreateIndex
CREATE INDEX "onion_shipment_item_packagingId_idx" ON "onion_shipment_item"("packagingId");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");
