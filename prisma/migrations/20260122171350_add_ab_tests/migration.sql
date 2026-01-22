-- CreateTable
CREATE TABLE "twenty_sync_metadata" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "initial_migration_completed" BOOLEAN NOT NULL DEFAULT false,
    "initial_migration_started_at" TIMESTAMP(3),
    "initial_migration_completed_at" TIMESTAMP(3),
    "total_records_migrated" INTEGER NOT NULL DEFAULT 0,
    "last_migration_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "twenty_sync_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ab_tests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "agent_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ab_test_variants" (
    "id" TEXT NOT NULL,
    "ab_test_id" TEXT NOT NULL,
    "agent_config_id" TEXT NOT NULL,
    "agent_config_name" TEXT NOT NULL,
    "voice_id" TEXT NOT NULL,
    "percentage" INTEGER NOT NULL,
    "total_calls" INTEGER NOT NULL DEFAULT 0,
    "total_connected" INTEGER NOT NULL DEFAULT 0,
    "total_converted" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ab_test_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ab_test_contacts" (
    "id" TEXT NOT NULL,
    "ab_test_variant_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "contactType" TEXT NOT NULL DEFAULT 'ESTABLISHMENT',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "called_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ab_test_contacts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ab_test_variants" ADD CONSTRAINT "ab_test_variants_ab_test_id_fkey" FOREIGN KEY ("ab_test_id") REFERENCES "ab_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_test_contacts" ADD CONSTRAINT "ab_test_contacts_ab_test_variant_id_fkey" FOREIGN KEY ("ab_test_variant_id") REFERENCES "ab_test_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
