ALTER TABLE "director_message"
  ADD COLUMN "proposalId" TEXT,
  ADD COLUMN "proposalVersion" INTEGER;

CREATE UNIQUE INDEX "director_message_proposalId_proposalVersion_key"
  ON "director_message"("proposalId", "proposalVersion");

-- Include earlier submissions in the conversation using their original actor and time.
INSERT INTO "director_message" ("id", "authorId", "authorName", "body", "proposalId", "proposalVersion", "createdAt")
SELECT 'proposal-submit-' || "id", "actorId", "actorName",
  'Poslat je predlog radnog naloga na pregled: ' || COALESCE("snapshot"->>'title', 'Predlog radnog naloga') || E'\nVerzija: ' || "version"::text,
  "proposalId", "version", "createdAt"
FROM "proposal_event"
WHERE "action" = 'submit';
