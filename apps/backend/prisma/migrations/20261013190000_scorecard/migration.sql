-- Scorecard architecture: plan, recording, telemetry, human decision, report
ALTER TABLE "Interview" ADD COLUMN "plan" JSONB;
ALTER TABLE "Interview" ADD COLUMN "difficulty" TEXT;
ALTER TABLE "Interview" ADD COLUMN "plannedDurationSec" INTEGER;
ALTER TABLE "Interview" ADD COLUMN "recordingData" TEXT;
ALTER TABLE "Interview" ADD COLUMN "recordingStartedAt" TIMESTAMP(3);
ALTER TABLE "Interview" ADD COLUMN "sessionEvents" JSONB;
ALTER TABLE "Interview" ADD COLUMN "humanDecision" JSONB;
ALTER TABLE "Interview" ADD COLUMN "report" JSONB;
ALTER TABLE "Interview" ADD COLUMN "reportModel" TEXT;