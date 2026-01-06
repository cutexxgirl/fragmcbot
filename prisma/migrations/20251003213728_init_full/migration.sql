-- CreateTable
CREATE TABLE "users" (
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "accessToken" TEXT NOT NULL,
    "subscriptionLevel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "isLegacy" BOOLEAN NOT NULL DEFAULT false,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "hasPromoAccess" BOOLEAN NOT NULL DEFAULT false,
    "expiresAtFragment" TIMESTAMP(3),
    "expiresAtPulse" TIMESTAMP(3),
    "expiresAtGearwire" TIMESTAMP(3),
    "expiresAtOuch" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRenewedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("telegramId")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_agents" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" SERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "agentId" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "senderId" BIGINT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statistic_events" (
    "id" SERIAL NOT NULL,
    "eventType" TEXT NOT NULL,
    "userId" BIGINT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statistic_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_requests" (
    "id" SERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "username" TEXT,
    "message" TEXT,
    "photoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processedBy" BIGINT,

    CONSTRAINT "promo_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" SERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "taskType" TEXT NOT NULL,
    "groupId" BIGINT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "executed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_accessToken_key" ON "users"("accessToken");

-- CreateIndex
CREATE UNIQUE INDEX "admins_telegramId_key" ON "admins"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "support_agents_telegramId_key" ON "support_agents"("telegramId");

-- CreateIndex
CREATE INDEX "statistic_events_eventType_idx" ON "statistic_events"("eventType");

-- CreateIndex
CREATE INDEX "statistic_events_userId_idx" ON "statistic_events"("userId");

-- CreateIndex
CREATE INDEX "statistic_events_createdAt_idx" ON "statistic_events"("createdAt");

-- CreateIndex
CREATE INDEX "scheduled_tasks_scheduledFor_executed_idx" ON "scheduled_tasks"("scheduledFor", "executed");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
