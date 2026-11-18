-- Keep version as the concurrency token; contentVersion is the user-facing revision.
ALTER TABLE "work_order_proposal" ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "proposal_event" ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 1;

-- Reconstruct content revisions from actual changes, ignoring display-name snapshots.
WITH snapshots AS (
  SELECT "proposalId", "version", "snapshot" - 'labels' AS content
  FROM "proposal_event"
  WHERE "action" IN ('create', 'edit') AND "snapshot" IS NOT NULL
), compared AS (
  SELECT *, LAG(content) OVER (PARTITION BY "proposalId" ORDER BY "version") AS previous
  FROM snapshots
), revisions AS (
  SELECT "proposalId", "version",
    SUM(CASE WHEN content IS DISTINCT FROM previous THEN 1 ELSE 0 END)
      OVER (PARTITION BY "proposalId" ORDER BY "version")::integer AS revision
  FROM compared
)
UPDATE "proposal_event" AS event SET "contentVersion" = COALESCE((
  SELECT revision FROM revisions
  WHERE revisions."proposalId" = event."proposalId" AND revisions."version" <= event."version"
  ORDER BY revisions."version" DESC LIMIT 1
), 1);

UPDATE "work_order_proposal" AS proposal SET "contentVersion" = COALESCE((
  SELECT MAX(event."contentVersion") FROM "proposal_event" AS event
  WHERE event."proposalId" = proposal.id
), 1);

-- Correct the version label in earlier automatic submission messages.
UPDATE "director_message" AS message
SET body = regexp_replace(message.body, 'Verzija: [0-9]+$', 'Verzija: ' || event."contentVersion"::text)
FROM "proposal_event" AS event
WHERE event."action" = 'submit' AND message."proposalId" = event."proposalId"
  AND message."proposalVersion" = event."version";
