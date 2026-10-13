import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { generatePlan } from '../lib/plan.js';
import { extractResumeText } from '../lib/resume.js';

const router = Router();

const CreateInterviewSchema = z.object({
    candidateName: z.string().min(1),
    candidateEmail: z.string().email().optional().or(z.literal('')),
    recruiterName: z.string().optional().or(z.literal('')),
    jobRole: z.string().optional().or(z.literal('')),
    jobDescription: z.string().min(1),
    resumeFileName: z.string().optional(),
    resumeBase64: z.string().optional(),
});

router.post("/", async (req, res) => {
    try {
        const { success, data } = CreateInterviewSchema.safeParse(req.body);
        if (!success) {
            res.status(400).json({ message: "Validation failed" });
            return;
        }

        let resumeText: string | null = null;
        if (data.resumeBase64) {
            try {
                resumeText = await extractResumeText(
                    Buffer.from(data.resumeBase64, 'base64'),
                    data.resumeFileName || 'resume.pdf'
                );
            } catch (err: any) {
                console.error("Resume extraction failed:", err?.message);
                res.status(400).json({ message: "Could not read the resume file. Upload a text-based PDF or paste the text into the job description." });
                return;
            }
        }

        const existingSameJd = await prisma.interview.findFirst({
            where: { jobDescription: data.jobDescription.trim() },
            orderBy: { startedAt: 'desc' },
        });
        const plan: any = existingSameJd?.plan && data.jobRole?.trim()
            ? { ...existingSameJd.plan, roleTitle: data.jobRole.trim().slice(0, 80) }
            : existingSameJd?.plan
                ? existingSameJd.plan
                : await generatePlan(resumeText, data.jobDescription.trim(), data.jobRole?.trim() || null);

        const interview = await prisma.interview.create({
            data: {
                candidateName: data.candidateName.trim(),
                candidateEmail: data.candidateEmail?.trim() || null,
                recruiterName: data.recruiterName?.trim() || null,
                jobDescription: data.jobDescription.trim(),
                resumeText,
                status: "Pre",
                plan: plan as any,
                difficulty: plan.difficulty,
                plannedDurationSec: plan.plannedDurationSec,
            }
        });

        res.status(201).json({
            id: interview.id,
            shareToken: interview.shareToken,
            shareUrl: `/room/${interview.shareToken}`,
            roleTitle: plan.roleTitle,
            difficulty: plan.difficulty,
            message: "Interview created"
        });
    } catch (err: any) {
        console.error("Create interview error:", err?.message);
        res.status(500).json({ message: "Internal server error" });
    }
});

router.get("/", async (_req, res) => {
    try {
        const interviews = await prisma.interview.findMany({
            orderBy: { startedAt: 'desc' },
            select: {
                id: true,
                candidateName: true,
                candidateEmail: true,
                recruiterName: true,
                status: true,
                score: true,
                videoScore: true,
                aiProbability: true,
                difficulty: true,
                plan: true,
                humanDecision: true,
                report: true,
                shareToken: true,
                startedAt: true,
                completedAt: true,
            }
        });
        const rows = interviews.map((i: any) => ({
            id: i.id,
            candidateName: i.candidateName,
            candidateEmail: i.candidateEmail,
            recruiterName: i.recruiterName,
            status: i.status,
            roleTitle: i.plan?.roleTitle || null,
            difficulty: i.difficulty,
            overall: i.report?.verdict?.overall ?? null,
            suggestion: i.report?.verdict?.suggestion ?? null,
            aiProbability: i.aiProbability,
            humanDecision: i.humanDecision?.decision ?? null,
            shareToken: i.shareToken,
            startedAt: i.startedAt,
            completedAt: i.completedAt,
        }));
        res.status(200).json(rows);
    } catch (err: any) {
        console.error("List interviews error:", err?.message);
        res.status(500).json({ message: "Internal server error" });
    }
});

router.get("/room/:token", async (req, res) => {
    try {
        const interview = await prisma.interview.findUnique({
            where: { shareToken: req.params.token }
        });
        if (!interview) {
            res.status(404).json({ message: "Interview link is invalid or expired" });
            return;
        }
        if (interview.status === "Done") {
            res.status(409).json({ message: "This interview has already been completed" });
            return;
        }
        const recordingToken = interview.recordingToken || (crypto.randomUUID());
        if (!interview.recordingToken) {
            await prisma.interview.update({ where: { id: interview.id }, data: { recordingToken } });
        }
        res.status(200).json({
            interviewId: interview.id,
            candidateName: interview.candidateName,
            recruiterName: interview.recruiterName,
            roleTitle: (interview.plan as any)?.roleTitle || null,
            plannedDurationSec: interview.plannedDurationSec || 300,
            recordingToken,
        });
    } catch (err: any) {
        console.error("Room lookup error:", err?.message);
        res.status(500).json({ message: "Internal server error" });
    }
});

const DecisionSchema = z.object({
    decision: z.enum(['proceed', 'hold', 'reject']),
    note: z.string().optional().or(z.literal('')),
});

router.put("/:id/decision", async (req, res) => {
    try {
        const { success, data } = DecisionSchema.safeParse(req.body);
        if (!success) {
            res.status(400).json({ message: "Validation failed" });
            return;
        }
        const existing = await prisma.interview.findUnique({ where: { id: req.params.id } });
        if (!existing) {
            res.status(404).json({ message: "Interview not found" });
            return;
        }
        await prisma.interview.update({
            where: { id: req.params.id },
            data: {
                humanDecision: {
                    decision: data.decision,
                    note: data.note?.trim() || null,
                    decidedAt: new Date().toISOString(),
                } as any,
            }
        });
        res.status(200).json({ message: "Decision recorded" });
    } catch (err: any) {
        console.error("Decision error:", err?.message);
        res.status(500).json({ message: "Internal server error" });
    }
});

const EmailSchema = z.object({ email: z.string().email() });

/** Candidate typed their email on the join screen. */
router.put("/:id/email", async (req, res) => {
    try {
        const { success, data } = EmailSchema.safeParse(req.body);
        if (!success) {
            res.status(400).json({ message: "Validation failed" });
            return;
        }
        const existing = await prisma.interview.findUnique({ where: { id: req.params.id } });
        if (!existing) {
            res.status(404).json({ message: "Interview not found" });
            return;
        }
        await prisma.interview.update({
            where: { id: req.params.id },
            data: { candidateEmail: data.email.trim() },
        });
        res.status(200).json({ message: "Email saved" });
    } catch (err: any) {
        res.status(500).json({ message: "Internal server error" });
    }
});

router.post("/:id/regenerate", async (req, res) => {
    try {
        const existing = await prisma.interview.findUnique({ where: { id: req.params.id } });
        if (!existing) {
            res.status(404).json({ message: "Interview not found" });
            return;
        }
        const { generateScorecardFor } = await import('./scorecard.js');
        const card = await generateScorecardFor(req.params.id);
        if (!card) {
            res.status(400).json({ message: "Nothing to grade yet — no transcript exists for this interview." });
            return;
        }
        res.status(200).json(card);
    } catch (err: any) {
        console.error("Regenerate error:", err?.message);
        res.status(500).json({ message: "Internal server error" });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma.interview.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Interview not found" });
            return;
        }
        await prisma.$transaction([
            prisma.message.deleteMany({ where: { interviewId: id } }),
            prisma.interview.delete({ where: { id } }),
        ]);
        res.status(200).json({ message: "Interview deleted" });
    } catch (err: any) {
        console.error("Delete interview error:", err?.message);
        res.status(500).json({ message: "Internal server error" });
    }
});

export default router;