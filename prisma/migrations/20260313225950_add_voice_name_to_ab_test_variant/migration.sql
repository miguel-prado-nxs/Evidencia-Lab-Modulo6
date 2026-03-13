/*
  Warnings:

  - You are about to drop the column `agent_config_name` on the `ab_test_variants` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ab_test_variants" DROP COLUMN "agent_config_name",
ADD COLUMN     "personality_id" TEXT,
ALTER COLUMN "agent_config_id" DROP NOT NULL,
ALTER COLUMN "voice_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "elevenlabs_personalities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "voice_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "elevenlabs_personalities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_interactions" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "conversation_id" TEXT,
    "customer_name" TEXT,
    "business_name" TEXT,
    "phone" TEXT,
    "current_step" TEXT,
    "issue_description" TEXT,
    "call_status" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "elevenlabs_personalities_name_key" ON "elevenlabs_personalities"("name");

-- CreateIndex
CREATE INDEX "onboarding_interactions_establishment_id_idx" ON "onboarding_interactions"("establishment_id");

-- CreateIndex
CREATE INDEX "onboarding_interactions_conversation_id_idx" ON "onboarding_interactions"("conversation_id");

-- AddForeignKey
ALTER TABLE "ab_test_variants" ADD CONSTRAINT "ab_test_variants_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "elevenlabs_personalities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
