-- Recording in progress flag on the class, and recording file/timing details.
ALTER TABLE "Session" ADD COLUMN "recordingActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Recording" ADD COLUMN "fileId" TEXT,
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "endedAt" TIMESTAMP(3),
ADD COLUMN "startedById" TEXT,
ADD COLUMN "deletedById" TEXT;
CREATE INDEX "Recording_sessionId_idx" ON "Recording"("sessionId");
