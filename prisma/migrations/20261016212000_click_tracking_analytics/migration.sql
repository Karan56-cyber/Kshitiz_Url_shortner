ALTER TABLE "click_events"
ADD COLUMN "deviceType" VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "browser" VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN';

CREATE INDEX "click_events_linkId_isBot_clickedAt_idx"
ON "click_events"("linkId", "isBot", "clickedAt");
