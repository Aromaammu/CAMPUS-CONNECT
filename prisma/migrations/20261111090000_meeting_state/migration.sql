-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "state" JSONB NOT NULL DEFAULT '{}';

