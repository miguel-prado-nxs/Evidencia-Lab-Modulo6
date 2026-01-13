-- CreateEnum
CREATE TYPE "TwentySyncJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "twenty_sync_states" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "twenty_establecimiento_id" TEXT,
    "twenty_contacto_id" TEXT,
    "twenty_prospecto_id" TEXT,
    "twenty_opportunity_id" TEXT,
    "twenty_cliente_id" TEXT,
    "last_synced_level" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "twenty_sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twenty_sync_jobs" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "partner_id" TEXT,
    "reason" TEXT NOT NULL,
    "status" "TwentySyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "twenty_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "twenty_sync_states_establishment_id_key" ON "twenty_sync_states"("establishment_id");

-- CreateIndex
CREATE INDEX "twenty_sync_states_twenty_establecimiento_id_idx" ON "twenty_sync_states"("twenty_establecimiento_id");

-- CreateIndex
CREATE INDEX "twenty_sync_states_twenty_opportunity_id_idx" ON "twenty_sync_states"("twenty_opportunity_id");

-- CreateIndex
CREATE INDEX "twenty_sync_states_last_synced_level_idx" ON "twenty_sync_states"("last_synced_level");

-- CreateIndex
CREATE INDEX "twenty_sync_jobs_status_next_run_at_idx" ON "twenty_sync_jobs"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "twenty_sync_jobs_establishment_id_idx" ON "twenty_sync_jobs"("establishment_id");

-- CreateIndex
CREATE INDEX "twenty_sync_jobs_created_at_idx" ON "twenty_sync_jobs"("created_at" DESC);
