-- Recording pipeline: per-turn timestamps + upload tokens
ALTER TABLE "Message" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "endedAt" TIMESTAMP(3);
ALTER TABLE "Interview" ADD COLUMN "recordingToken" TEXT;