-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "assignedBy" BIGINT,
ADD COLUMN     "reassignedCount" INTEGER NOT NULL DEFAULT 0;
