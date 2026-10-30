-- Domain baseline after the original auth migration.
-- Existing db-push installations must verify their schema and baseline this migration.
BEGIN;
-- CreateEnum
CREATE TYPE "WorkerType" AS ENUM ('STALNI', 'SEZONAC');

-- CreateEnum
CREATE TYPE "MachineType" AS ENUM ('TRAKTOR', 'PRIKLJUCAK', 'KOMBAJN', 'KAMION', 'VILJUSKAR', 'OSTALO');

-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('SLOBODNA', 'ZADUZENA', 'U_KVARU', 'SERVIS');

-- CreateEnum
CREATE TYPE "WorkCategory" AS ENUM ('OBRADA', 'ZASTITA', 'SETVA', 'ZETVA_BERBA', 'TRANSPORT', 'OSTALO');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('KUPAC', 'DOBAVLJAC', 'SERVIS', 'OBA');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('PRVA', 'DRUGA', 'TRECA');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('U_TOKU', 'ZAVRSENO', 'STORNO');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ZADUZENA', 'RAZDUZENA', 'VRACENA_SA_KVAROM');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('RAD_NJIVA', 'REMONT_SERVIS', 'OSTALO');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PLANIRAN', 'DODELJEN', 'U_TOKU', 'ZAVRSEN', 'OTKAZAN');

-- CreateEnum
CREATE TYPE "FuelSource" AS ENUM ('CISTERNA', 'PUMPA', 'KANISTER');

-- CreateEnum
CREATE TYPE "IssuePriority" AS ENUM ('NISKA', 'SREDNJA', 'VISOKA', 'KRITICNA');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OTVOREN', 'U_RADU', 'CEKA_DELOVE', 'POPRAVLJENO', 'OTKAZAN');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('KVAR_NJIVA', 'REDOVAN_SERVIS', 'GENERALNI_REMONT');

-- CreateEnum
CREATE TYPE "FertilizerType" AS ENUM ('MINERALNO_GRANULISANO', 'VODOTOPIVO_FERTIRIGACIJA', 'TECNI_BIOSTIMULATOR', 'ORGANSKO_PELETIRANO');

-- CreateEnum
CREATE TYPE "FertilizerUnit" AS ENUM ('KG', 'L', 'TONA');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PRIJEM_NABAVKA', 'IZDAVANJE_NJIVA', 'POVRAT_SA_NJIVE', 'OTPIS_KOREKCIJA');

-- CreateEnum
CREATE TYPE "OnionLotStatus" AS ENUM ('NA_STANJU', 'U_OBRADI', 'ISPORUCEN', 'ARHIVIRAN');

-- CreateEnum
CREATE TYPE "OnionStorageType" AS ENUM ('HLADNJACA', 'MAGACIN');

-- CreateEnum
CREATE TYPE "OnionPackageType" AS ENUM ('DZAK_5KG', 'DZAK_10KG', 'DZAK_25KG', 'DZAMBO_VRECA', 'BOKS_PALETA', 'RINFUZ', 'DRUGO');

-- CreateEnum
CREATE TYPE "OnionWasteReason" AS ENUM ('TRULEZ', 'MEHANICKO_OSTECENJE', 'KALO_SUSENJE', 'PROKLIJAO', 'PRLJAVSTINA_ZEMLJA', 'OSTALO');

-- CreateTable
CREATE TABLE "worker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WorkerType" NOT NULL DEFAULT 'STALNI',
    "role" "Role",
    "city" TEXT,
    "dailyWage" DOUBLE PRECISION,
    "jmbg" TEXT,
    "phone" TEXT,
    "hourlyRate" DOUBLE PRECISION DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "areaHa" DOUBLE PRECISION NOT NULL,
    "location" TEXT,
    "currentCrop" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MachineType" NOT NULL DEFAULT 'TRAKTOR',
    "brandModel" TEXT,
    "regNumber" TEXT,
    "year" INTEGER,
    "currentHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "MachineStatus" NOT NULL DEFAULT 'SLOBODNA',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tankCapacityLiters" DOUBLE PRECISION DEFAULT 200,
    "currentFuelLiters" DOUBLE PRECISION DEFAULT 0,
    "enpTagNumber" TEXT,
    "enpTagBalance" DOUBLE PRECISION DEFAULT 0,

    CONSTRAINT "machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_type" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "WorkCategory" NOT NULL DEFAULT 'OBRADA',
    "unit" TEXT NOT NULL DEFAULT 'ha',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fuelNormLitersPerHa" DOUBLE PRECISION,
    "laborPricePerHa" DOUBLE PRECISION,
    "totalPricePerHa" DOUBLE PRECISION,
    "referenceFuelPrice" DOUBLE PRECISION DEFAULT 171.66,

    CONSTRAINT "work_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variety" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL DEFAULT 'KUPAC',
    "pib" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_work" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shift" "ShiftType" NOT NULL DEFAULT 'PRVA',
    "parcelId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "attachmentId" TEXT,
    "workerId" TEXT NOT NULL,
    "workTypeId" TEXT NOT NULL,
    "areaDoneHa" DOUBLE PRECISION NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "workHours" DOUBLE PRECISION,
    "status" "WorkStatus" NOT NULL DEFAULT 'ZAVRSENO',
    "notes" TEXT,
    "photoUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_assignment" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "parcelId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startFuelLevel" DOUBLE PRECISION,
    "startFuelLiters" DOUBLE PRECISION,
    "startHours" DOUBLE PRECISION NOT NULL,
    "assignNotes" TEXT,
    "returnedAt" TIMESTAMP(3),
    "endFuelLevel" DOUBLE PRECISION,
    "endFuelLiters" DOUBLE PRECISION,
    "endHours" DOUBLE PRECISION,
    "isOperational" BOOLEAN NOT NULL DEFAULT true,
    "returnNotes" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ZADUZENA',
    "workOrderId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "orderType" "OrderType" NOT NULL DEFAULT 'RAD_NJIVA',
    "status" "OrderStatus" NOT NULL DEFAULT 'PLANIRAN',
    "priority" TEXT NOT NULL DEFAULT 'NORMALNO',
    "workerId" TEXT NOT NULL,
    "machineId" TEXT,
    "attachmentId" TEXT,
    "parcelId" TEXT,
    "workTypeId" TEXT,
    "plannedAreaHa" DOUBLE PRECISION,
    "shift" "ShiftType" NOT NULL DEFAULT 'PRVA',
    "instructions" TEXT,
    "fieldWorkId" TEXT,
    "maintenanceId" TEXT,
    "issuedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_entry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "machineId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "fieldWorkId" TEXT,
    "fuelSource" "FuelSource" NOT NULL DEFAULT 'CISTERNA',
    "gasStation" TEXT,
    "fuelType" TEXT NOT NULL DEFAULT 'EURODIZEL',
    "liters" DOUBLE PRECISION NOT NULL,
    "pricePerLiter" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "receiptImageUrl" TEXT,
    "hasAnomaly" BOOLEAN NOT NULL DEFAULT false,
    "anomalyReason" TEXT,
    "receiptNumber" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_supply" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fuelType" TEXT NOT NULL DEFAULT 'EURODIZEL',
    "liters" DOUBLE PRECISION NOT NULL,
    "pricePerLiter" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "receiptNumber" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_supply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_issue" (
    "id" TEXT NOT NULL,
    "dateReported" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serviceType" "ServiceType" NOT NULL DEFAULT 'KVAR_NJIVA',
    "priority" "IssuePriority" NOT NULL DEFAULT 'SREDNJA',
    "status" "IssueStatus" NOT NULL DEFAULT 'OTVOREN',
    "machineId" TEXT NOT NULL,
    "parcelId" TEXT,
    "reportedById" TEXT NOT NULL,
    "mechanicId" TEXT,
    "servicePartnerId" TEXT,
    "isMachineStopped" BOOLEAN NOT NULL DEFAULT false,
    "downtimeHours" DOUBLE PRECISION DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "photoUrl" TEXT,
    "repairedAt" TIMESTAMP(3),
    "repairNotes" TEXT,
    "partsReplaced" TEXT,
    "lubricantType" TEXT,
    "lubricantLiters" DOUBLE PRECISION,
    "partsCost" DOUBLE PRECISION DEFAULT 0,
    "laborCost" DOUBLE PRECISION DEFAULT 0,
    "totalCost" DOUBLE PRECISION DEFAULT 0,
    "invoicePhotoUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toll_entry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "machineId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'ENP_TAG',
    "tagNumber" TEXT,
    "entryStation" TEXT,
    "exitStation" TEXT,
    "routeRelation" TEXT,
    "receiptNumber" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "toll_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toll_top_up" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "machineId" TEXT NOT NULL,
    "tagNumber" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentReference" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "toll_top_up_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fertilizer_product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FertilizerType" NOT NULL DEFAULT 'MINERALNO_GRANULISANO',
    "unit" "FertilizerUnit" NOT NULL DEFAULT 'KG',
    "currentStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minStockWarning" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "defaultPricePerUnit" DOUBLE PRECISION DEFAULT 0,
    "defaultLocation" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fertilizer_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fertilizer_movement" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movementType" "StockMovementType" NOT NULL DEFAULT 'IZDAVANJE_NJIVA',
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "supplierId" TEXT,
    "receiptNumber" TEXT,
    "warehouseLocation" TEXT,
    "parcelId" TEXT,
    "cropName" TEXT,
    "areaHa" DOUBLE PRECISION,
    "kgPerHa" DOUBLE PRECISION,
    "issuedById" TEXT NOT NULL,
    "receivedWorkerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fertilizer_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonal_group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasonal_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonal_worker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "groupName" TEXT,
    "dailyWage" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasonal_worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonal_work_log" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seasonalWorkerId" TEXT NOT NULL,
    "parcelId" TEXT,
    "jobDescription" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "hoursWorked" DOUBLE PRECISION NOT NULL,
    "dailyWageApplied" DOUBLE PRECISION,
    "supervisorId" TEXT NOT NULL,
    "groupName" TEXT,
    "groupCount" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasonal_work_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onion_lot" (
    "id" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "status" "OnionLotStatus" NOT NULL DEFAULT 'NA_STANJU',
    "parcelId" TEXT NOT NULL,
    "cropVariety" TEXT,
    "initialQuantityKg" DOUBLE PRECISION NOT NULL,
    "rawStockKg" DOUBLE PRECISION NOT NULL,
    "sortedQualityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortedSmallKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortedWasteKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "packagedStockKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalWasteKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onion_lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onion_harvest_arrival" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lotId" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "trailerInfo" TEXT,
    "supervisorId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onion_harvest_arrival_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onion_storage_entry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lotId" TEXT NOT NULL,
    "storageType" "OnionStorageType" NOT NULL DEFAULT 'HLADNJACA',
    "locationOrChamber" TEXT NOT NULL,
    "hasEquipment" BOOLEAN NOT NULL DEFAULT true,
    "boxCount" INTEGER,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "currentQuantityKg" DOUBLE PRECISION NOT NULL,
    "temperatureC" DOUBLE PRECISION,
    "humidityPercent" DOUBLE PRECISION,
    "supervisorId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onion_storage_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onion_sorting" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lotId" TEXT NOT NULL,
    "inputQuantityKg" DOUBLE PRECISION NOT NULL,
    "qualityQuantityKg" DOUBLE PRECISION NOT NULL,
    "smallQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wasteQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wastePercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "storageEntryId" TEXT,
    "supervisorId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onion_sorting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onion_packaging" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lotId" TEXT NOT NULL,
    "packageType" "OnionPackageType" NOT NULL DEFAULT 'DZAK_10KG',
    "unitWeightKg" DOUBLE PRECISION NOT NULL,
    "packageCount" INTEGER NOT NULL,
    "totalWeightKg" DOUBLE PRECISION NOT NULL,
    "availableCount" INTEGER NOT NULL,
    "availableWeightKg" DOUBLE PRECISION NOT NULL,
    "palletsCount" DOUBLE PRECISION,
    "palletNumber" TEXT,
    "packerCount" INTEGER NOT NULL DEFAULT 4,
    "packerNotes" TEXT,
    "responsiblePerson" TEXT DEFAULT 'Bojan Ćorović',
    "supervisorId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onion_packaging_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onion_shipment" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchNumber" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "totalWeightKg" DOUBLE PRECISION NOT NULL,
    "totalPackagesCount" INTEGER NOT NULL,
    "pricePerKg" DOUBLE PRECISION,
    "totalValue" DOUBLE PRECISION,
    "vehicleReg" TEXT,
    "driverName" TEXT,
    "supervisorId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onion_shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onion_shipment_item" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "packagingId" TEXT NOT NULL,
    "packageCount" INTEGER NOT NULL,
    "totalWeightKg" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "onion_shipment_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onion_waste" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lotId" TEXT NOT NULL,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "reason" "OnionWasteReason" NOT NULL DEFAULT 'TRULEZ',
    "description" TEXT,
    "location" TEXT,
    "supervisorId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onion_waste_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worker_userId_key" ON "worker"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "parcel_code_key" ON "parcel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "work_type_name_key" ON "work_type"("name");

-- CreateIndex
CREATE INDEX "field_work_date_idx" ON "field_work"("date");

-- CreateIndex
CREATE INDEX "field_work_parcelId_date_idx" ON "field_work"("parcelId", "date");

-- CreateIndex
CREATE INDEX "field_work_workerId_date_idx" ON "field_work"("workerId", "date");

-- CreateIndex
CREATE INDEX "field_work_machineId_date_idx" ON "field_work"("machineId", "date");

-- CreateIndex
CREATE INDEX "field_work_attachmentId_date_idx" ON "field_work"("attachmentId", "date");

-- CreateIndex
CREATE INDEX "machine_assignment_machineId_status_idx" ON "machine_assignment"("machineId", "status");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_userId_idx" ON "audit_log"("userId");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_orderNumber_key" ON "work_order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_fieldWorkId_key" ON "work_order"("fieldWorkId");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_maintenanceId_key" ON "work_order"("maintenanceId");

-- CreateIndex
CREATE INDEX "work_order_orderDate_status_idx" ON "work_order"("orderDate", "status");

-- CreateIndex
CREATE INDEX "work_order_workerId_orderDate_idx" ON "work_order"("workerId", "orderDate");

-- CreateIndex
CREATE INDEX "fuel_entry_machineId_date_idx" ON "fuel_entry"("machineId", "date");

-- CreateIndex
CREATE INDEX "fuel_entry_date_idx" ON "fuel_entry"("date");

-- CreateIndex
CREATE INDEX "fuel_entry_gasStation_idx" ON "fuel_entry"("gasStation");

-- CreateIndex
CREATE INDEX "fuel_supply_date_idx" ON "fuel_supply"("date");

-- CreateIndex
CREATE INDEX "maintenance_issue_machineId_status_idx" ON "maintenance_issue"("machineId", "status");

-- CreateIndex
CREATE INDEX "maintenance_issue_parcelId_status_idx" ON "maintenance_issue"("parcelId", "status");

-- CreateIndex
CREATE INDEX "maintenance_issue_status_idx" ON "maintenance_issue"("status");

-- CreateIndex
CREATE INDEX "toll_entry_machineId_date_idx" ON "toll_entry"("machineId", "date");

-- CreateIndex
CREATE INDEX "toll_entry_workerId_date_idx" ON "toll_entry"("workerId", "date");

-- CreateIndex
CREATE INDEX "toll_entry_date_idx" ON "toll_entry"("date");

-- CreateIndex
CREATE INDEX "toll_top_up_machineId_date_idx" ON "toll_top_up"("machineId", "date");

-- CreateIndex
CREATE INDEX "toll_top_up_date_idx" ON "toll_top_up"("date");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscription_userId_idx" ON "push_subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "fertilizer_product_name_key" ON "fertilizer_product"("name");

-- CreateIndex
CREATE INDEX "fertilizer_movement_productId_date_idx" ON "fertilizer_movement"("productId", "date");

-- CreateIndex
CREATE INDEX "fertilizer_movement_parcelId_date_idx" ON "fertilizer_movement"("parcelId", "date");

-- CreateIndex
CREATE INDEX "fertilizer_movement_movementType_idx" ON "fertilizer_movement"("movementType");

-- CreateIndex
CREATE UNIQUE INDEX "seasonal_group_name_key" ON "seasonal_group"("name");

-- CreateIndex
CREATE INDEX "seasonal_worker_name_idx" ON "seasonal_worker"("name");

-- CreateIndex
CREATE INDEX "seasonal_worker_groupName_idx" ON "seasonal_worker"("groupName");

-- CreateIndex
CREATE INDEX "seasonal_work_log_seasonalWorkerId_date_idx" ON "seasonal_work_log"("seasonalWorkerId", "date");

-- CreateIndex
CREATE INDEX "seasonal_work_log_parcelId_date_idx" ON "seasonal_work_log"("parcelId", "date");

-- CreateIndex
CREATE INDEX "seasonal_work_log_date_idx" ON "seasonal_work_log"("date");

-- CreateIndex
CREATE UNIQUE INDEX "onion_lot_lotNumber_key" ON "onion_lot"("lotNumber");

-- CreateIndex
CREATE INDEX "onion_lot_lotNumber_idx" ON "onion_lot"("lotNumber");

-- CreateIndex
CREATE INDEX "onion_lot_parcelId_idx" ON "onion_lot"("parcelId");

-- CreateIndex
CREATE INDEX "onion_lot_status_idx" ON "onion_lot"("status");

-- CreateIndex
CREATE INDEX "onion_harvest_arrival_lotId_date_idx" ON "onion_harvest_arrival"("lotId", "date");

-- CreateIndex
CREATE INDEX "onion_harvest_arrival_parcelId_idx" ON "onion_harvest_arrival"("parcelId");

-- CreateIndex
CREATE INDEX "onion_storage_entry_lotId_storageType_idx" ON "onion_storage_entry"("lotId", "storageType");

-- CreateIndex
CREATE INDEX "onion_sorting_lotId_date_idx" ON "onion_sorting"("lotId", "date");

-- CreateIndex
CREATE INDEX "onion_packaging_lotId_packageType_idx" ON "onion_packaging"("lotId", "packageType");

-- CreateIndex
CREATE UNIQUE INDEX "onion_shipment_dispatchNumber_key" ON "onion_shipment"("dispatchNumber");

-- CreateIndex
CREATE INDEX "onion_shipment_buyerId_date_idx" ON "onion_shipment"("buyerId", "date");

-- CreateIndex
CREATE INDEX "onion_shipment_lotId_idx" ON "onion_shipment"("lotId");

-- CreateIndex
CREATE INDEX "onion_waste_lotId_reason_idx" ON "onion_waste"("lotId", "reason");

-- AddForeignKey
ALTER TABLE "worker" ADD CONSTRAINT "worker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_work" ADD CONSTRAINT "field_work_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_work" ADD CONSTRAINT "field_work_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_work" ADD CONSTRAINT "field_work_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_work" ADD CONSTRAINT "field_work_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_work" ADD CONSTRAINT "field_work_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_work" ADD CONSTRAINT "field_work_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignment" ADD CONSTRAINT "machine_assignment_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignment" ADD CONSTRAINT "machine_assignment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignment" ADD CONSTRAINT "machine_assignment_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignment" ADD CONSTRAINT "machine_assignment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignment" ADD CONSTRAINT "machine_assignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_fieldWorkId_fkey" FOREIGN KEY ("fieldWorkId") REFERENCES "field_work"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "maintenance_issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_entry" ADD CONSTRAINT "fuel_entry_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_entry" ADD CONSTRAINT "fuel_entry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_entry" ADD CONSTRAINT "fuel_entry_fieldWorkId_fkey" FOREIGN KEY ("fieldWorkId") REFERENCES "field_work"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_entry" ADD CONSTRAINT "fuel_entry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_supply" ADD CONSTRAINT "fuel_supply_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_supply" ADD CONSTRAINT "fuel_supply_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_issue" ADD CONSTRAINT "maintenance_issue_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_issue" ADD CONSTRAINT "maintenance_issue_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_issue" ADD CONSTRAINT "maintenance_issue_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_issue" ADD CONSTRAINT "maintenance_issue_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_issue" ADD CONSTRAINT "maintenance_issue_servicePartnerId_fkey" FOREIGN KEY ("servicePartnerId") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_issue" ADD CONSTRAINT "maintenance_issue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toll_entry" ADD CONSTRAINT "toll_entry_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toll_entry" ADD CONSTRAINT "toll_entry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toll_entry" ADD CONSTRAINT "toll_entry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toll_top_up" ADD CONSTRAINT "toll_top_up_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toll_top_up" ADD CONSTRAINT "toll_top_up_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_movement" ADD CONSTRAINT "fertilizer_movement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "fertilizer_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_movement" ADD CONSTRAINT "fertilizer_movement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_movement" ADD CONSTRAINT "fertilizer_movement_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_movement" ADD CONSTRAINT "fertilizer_movement_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_movement" ADD CONSTRAINT "fertilizer_movement_receivedWorkerId_fkey" FOREIGN KEY ("receivedWorkerId") REFERENCES "worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonal_work_log" ADD CONSTRAINT "seasonal_work_log_seasonalWorkerId_fkey" FOREIGN KEY ("seasonalWorkerId") REFERENCES "seasonal_worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonal_work_log" ADD CONSTRAINT "seasonal_work_log_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonal_work_log" ADD CONSTRAINT "seasonal_work_log_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_lot" ADD CONSTRAINT "onion_lot_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_harvest_arrival" ADD CONSTRAINT "onion_harvest_arrival_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "onion_lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_harvest_arrival" ADD CONSTRAINT "onion_harvest_arrival_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_harvest_arrival" ADD CONSTRAINT "onion_harvest_arrival_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_harvest_arrival" ADD CONSTRAINT "onion_harvest_arrival_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_harvest_arrival" ADD CONSTRAINT "onion_harvest_arrival_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_storage_entry" ADD CONSTRAINT "onion_storage_entry_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "onion_lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_storage_entry" ADD CONSTRAINT "onion_storage_entry_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_sorting" ADD CONSTRAINT "onion_sorting_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "onion_lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_sorting" ADD CONSTRAINT "onion_sorting_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_packaging" ADD CONSTRAINT "onion_packaging_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "onion_lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_packaging" ADD CONSTRAINT "onion_packaging_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_shipment" ADD CONSTRAINT "onion_shipment_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_shipment" ADD CONSTRAINT "onion_shipment_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "onion_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_shipment" ADD CONSTRAINT "onion_shipment_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_shipment_item" ADD CONSTRAINT "onion_shipment_item_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "onion_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_shipment_item" ADD CONSTRAINT "onion_shipment_item_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "onion_packaging"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_waste" ADD CONSTRAINT "onion_waste_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "onion_lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onion_waste" ADD CONSTRAINT "onion_waste_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
