-- DropForeignKey
ALTER TABLE "public"."ticket_messages" DROP CONSTRAINT "ticket_messages_ticketId_fkey";

-- AlterTable
ALTER TABLE "admins" ADD COLUMN     "logActionsToLichka" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "renewalCheckInterval" INTEGER NOT NULL DEFAULT 3600,
ADD COLUMN     "securityCheckInterval" INTEGER NOT NULL DEFAULT 86400,
ADD COLUMN     "tokenLifetime" INTEGER NOT NULL DEFAULT 2678400,
ADD COLUMN     "wipeConfirmationCode" TEXT;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
