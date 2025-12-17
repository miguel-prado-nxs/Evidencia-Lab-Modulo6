/*
  Warnings:

  - You are about to drop the `establishments` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "establishments";

-- CreateTable
CREATE TABLE "establishment_meetings" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "meeting_scheduled" BOOLEAN NOT NULL DEFAULT false,
    "meeting_date" TIMESTAMP(3),
    "meeting_link" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "establishment_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "establishment_meetings_partner_id_idx" ON "establishment_meetings"("partner_id");

-- CreateIndex
CREATE INDEX "establishment_meetings_establishment_id_idx" ON "establishment_meetings"("establishment_id");

-- CreateIndex
CREATE INDEX "establishment_meetings_meeting_scheduled_idx" ON "establishment_meetings"("meeting_scheduled");

-- CreateIndex
CREATE INDEX "establishment_meetings_meeting_date_idx" ON "establishment_meetings"("meeting_date");

-- CreateIndex
CREATE UNIQUE INDEX "establishment_meetings_establishment_id_partner_id_key" ON "establishment_meetings"("establishment_id", "partner_id");

-- AddForeignKey
ALTER TABLE "establishment_meetings" ADD CONSTRAINT "establishment_meetings_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
