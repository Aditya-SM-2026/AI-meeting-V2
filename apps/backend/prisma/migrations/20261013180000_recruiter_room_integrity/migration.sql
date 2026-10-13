-- Add candidate/recruiter/integrity fields to Interview, timestamps to Message
ALTER TABLE "Interview" ADD COLUMN "candidateName" TEXT NOT NULL;
ALTER TABLE "Interview" ADD COLUMN "candidateEmail" TEXT;
ALTER TABLE "Interview" ADD COLUMN "recruiterName" TEXT;
ALTER TABLE "Interview" ADD COLUMN "resumeText" TEXT;
ALTER TABLE "Interview" ADD COLUMN "jobDescription" TEXT;
ALTER TABLE "Interview" ADD COLUMN "shareToken" TEXT NOT NULL UNIQUE;
ALTER TABLE "Interview" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "Interview" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "Interview" ADD COLUMN "sessionMetrics" JSONB;
ALTER TABLE "Interview" ADD COLUMN "integrityReport" JSONB;
ALTER TABLE "Interview" ADD COLUMN "aiProbability" INTEGER;
ALTER TABLE "Message" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;