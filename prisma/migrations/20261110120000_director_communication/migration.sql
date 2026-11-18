CREATE TABLE "director_message" (
  "id" TEXT NOT NULL, "authorId" TEXT NOT NULL, "authorName" TEXT NOT NULL,
  "body" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "director_message_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "director_message_createdAt_id_idx" ON "director_message"("createdAt", "id");

CREATE TABLE "director_notification" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "messageId" TEXT, "proposalId" TEXT,
  "title" TEXT NOT NULL, "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "director_notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "director_notification_target_check" CHECK (("messageId" IS NOT NULL) <> ("proposalId" IS NOT NULL))
);
CREATE INDEX "director_notification_userId_readAt_createdAt_idx" ON "director_notification"("userId", "readAt", "createdAt");

CREATE TABLE "work_order_proposal" (
  "id" TEXT NOT NULL, "authorId" TEXT NOT NULL, "authorName" TEXT NOT NULL, "reviewerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NACRT', "version" INTEGER NOT NULL DEFAULT 1, "data" JSONB NOT NULL,
  "approvedById" TEXT, "approvedByName" TEXT, "approvedAt" TIMESTAMP(3), "approvedVersion" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "work_order_proposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_order_proposal_status_check" CHECK ("status" IN ('NACRT', 'NA_PREGLEDU', 'VRACEN_NA_DORADU', 'ODOBREN', 'OTKAZAN')),
  CONSTRAINT "work_order_proposal_version_check" CHECK ("version" > 0),
  CONSTRAINT "work_order_proposal_approval_check" CHECK ("status" <> 'ODOBREN' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "approvedVersion" IS NOT NULL AND "approvedVersion" = "version"))
);
CREATE INDEX "work_order_proposal_updatedAt_id_idx" ON "work_order_proposal"("updatedAt", "id");

CREATE TABLE "proposal_event" (
  "id" TEXT NOT NULL, "proposalId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "actorName" TEXT NOT NULL,
  "action" TEXT NOT NULL, "version" INTEGER NOT NULL, "body" TEXT, "snapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_event_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "work_order_proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposal_event_proposalId_createdAt_id_idx" ON "proposal_event"("proposalId", "createdAt", "id");
