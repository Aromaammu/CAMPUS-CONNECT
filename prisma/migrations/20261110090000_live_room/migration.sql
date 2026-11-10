-- AlterTable
ALTER TABLE "PresenceInterval" ADD COLUMN     "participantSid" TEXT,
ADD COLUMN     "role" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "camAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "micAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "removedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "shareUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "PresenceInterval_participantSid_key" ON "PresenceInterval"("participantSid");

