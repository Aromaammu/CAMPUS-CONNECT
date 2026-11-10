-- Whiteboard shown to everyone, and students given the pen.
ALTER TABLE "Session" ADD COLUMN "boardOpen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "penUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
