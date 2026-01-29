/*
  Warnings:
*/
-- DropForeignKey
ALTER TABLE "ab_test_call_logs" DROP CONSTRAINT "ab_test_call_logs_ab_test_id_fkey";

-- DropForeignKey
ALTER TABLE "ab_test_call_logs" DROP CONSTRAINT "ab_test_call_logs_variant_id_fkey";

-- DropForeignKey
ALTER TABLE "ab_test_events" DROP CONSTRAINT "ab_test_events_ab_test_id_fkey";

-- DropIndex
DROP INDEX "ab_test_contacts_batch_id_idx";

-- DropIndex
DROP INDEX "ab_test_contacts_contact_hash_idx";

-- AlterTable
ALTER TABLE "ab_test_candidates" DROP CONSTRAINT "ab_test_candidates_pkey",
DROP COLUMN "added_at",
DROP COLUMN "metadata",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "ab_test_candidates_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "ab_test_contacts" DROP COLUMN "assigned_variant_at",
DROP COLUMN "attempt_count",
DROP COLUMN "batch_id",
DROP COLUMN "contact_hash",
DROP COLUMN "last_attempted_at";

-- AlterTable
ALTER TABLE "ab_tests" DROP COLUMN "completion_criteria",
DROP COLUMN "config",
DROP COLUMN "user_id",
ADD COLUMN     "created_by" TEXT;

-- DropTable
DROP TABLE "ab_test_call_logs";

-- DropTable
DROP TABLE "ab_test_events";

-- CreateIndex
CREATE UNIQUE INDEX "ab_test_candidates_establishment_id_key" ON "ab_test_candidates"("establishment_id");

-- CreateIndex
CREATE INDEX "ab_tests_created_by_idx" ON "ab_tests"("created_by");
