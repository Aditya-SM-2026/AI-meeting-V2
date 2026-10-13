import { Router } from 'express';
import { PreInterviewSchema, VideoAnalysisSchema } from '../types.js';
import axios from 'axios';
import prisma from '../lib/prisma.js';
import { generateInterviewSummary, analyzeVideoPerformance, generateIntegrityReport } from '../lib/gemini.js';
import { analyzeVideoFrames } from '../lib/video.js';

const router = Router();

router.post("/pre-interview", async (req, res) => {
    try {
        const { success, data } = PreInterviewSchema.safeParse(req.body)
        if (!success) {
            res.status(400).json({
                message: "Validation failed"
            })
            return;
        }
        let githubUsername = data.github;
        if (githubUsername.includes("github.com/")) {
            githubUsername = githubUsername.split("github.com/")[1].split("/")[0];
        } else if (githubUsername.includes("/")) {
            githubUsername = githubUsername.split("/").pop() || githubUsername;
        }
        //Todo: Add proxy because github will rate limit you request
        const userRepo = await axios.get(`https://api.github.com/users/${githubUsername}/repos`)

        const filteredRepoData = userRepo.data.map((item: any) => ({
            description: item.description,
            name: item.name,
            fullName: item.fullName,
            startCount: item.startCount
        }))

        const interview = await prisma.interview.create({
            data: {
                githubMetadata: filteredRepoData,
                status: "Pre",
                score: 0
            }
        })

        return res.status(200).json({
            id: interview.id,
            message: "Success"
        })

    } catch (err: any) {
        console.log(err.message)
        res.status(500).json({ message: "Internal server error" })
    }
});

router.post("/session", async (req, res) => {
    console.log("session init")
    const sessionConfig = JSON.stringify({
        type: "realtime",
        model: "gemini-3.5-realtime",
        audio: { output: { voice: "marin" } },
    });

    const fd = new FormData();
    fd.set("sdp", req.body);
    fd.set("session", sessionConfig);

    try {


        // initSideband(callId, req.params.interviewId);
    } catch (error: any) {
        console.error("Gemini session error:", error);
        res.status(500).json({ error: "Failed to create Gemini realtime session" });
    }
});

router.get("/messages", async (req, res) => {
    try {
        const interviewId = req.body.interviewId as string;
        if (!interviewId) {
            return res.status(400).json({ message: "Missing interviewId query parameter" });
        }
        const messages = await prisma.message.findMany({
            where: { interviewId },
        });

        res.status(200).json(messages);
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

router.post("/video-analysis", async (req, res) => {
    try {
        const { success, data } = VideoAnalysisSchema.safeParse(req.body)
        if (!success) {
            res.status(400).json({
                message: "Validation failed"
            })
            return;
        }

        const interview = await prisma.interview.findUnique({ where: { id: data.interviewId } })
        if (!interview) {
            res.status(404).json({ message: "Interview not found" })
            return;
        }

        const analysis = await analyzeVideoFrames(data.frames)

        await prisma.interview.update({
            where: { id: data.interviewId },
            data: {
                videoFeedback: analysis as any,
                ...(Array.isArray((req.body as any)?.events) ? { sessionEvents: (req.body as any).events as any } : {}),
                ...((req.body as any)?.recordingStartedAt ? { recordingStartedAt: new Date((req.body as any).recordingStartedAt) } : {}),
            }
        })

        res.status(200).json(analysis)
    } catch (err: any) {
        console.error("Video analysis error:", err?.message)
        res.status(500).json({ message: "Internal server error" })
    }
});

router.get("/result/:interviewId", async (req, res) => {
    try {
        const { interviewId } = req.params;

        const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
        if (!interview) {
            res.status(404).json({ message: "Interview not found" });
            return;
        }

        const { loadTurns, generateScorecardFor } = await import('./scorecard.js');
        let scorecard: any = interview.report;
        if (!scorecard) {
            scorecard = await generateScorecardFor(interviewId);
        }

        const turns = await loadTurns(interviewId);

        // Peers: other interviews for the same role
        const roleTitle = (interview.plan as any)?.roleTitle || null;
        const peerRows = roleTitle
            ? await prisma.$queryRaw<any[]>`
                SELECT id, "candidateName", status, report, "humanDecision", "completedAt"
                FROM "Interview"
                WHERE id <> ${interviewId}
                  AND plan->>'roleTitle' = ${roleTitle}
                ORDER BY "startedAt" DESC LIMIT 6`
            : [];

        res.status(200).json({
            candidateName: interview.candidateName,
            candidateEmail: interview.candidateEmail,
            recruiterName: interview.recruiterName,
            status: interview.status,
            roleTitle,
            difficulty: interview.difficulty,
            plannedDurationSec: interview.plannedDurationSec,
            startedAt: interview.startedAt,
            completedAt: interview.completedAt,
            jobDescription: interview.jobDescription,
            resumeText: interview.resumeText,
            plan: interview.plan,
            scorecard,
            humanDecision: interview.humanDecision,
            recording: {
                hasRecording: Boolean(interview.recordingData),
                recordingStartedAt: interview.recordingStartedAt,
                recordingUrl: interview.recordingData ? `/api/v1/interviews/${interviewId}/recording` : null,
            },
            transcript: turns.map((t) => ({
                seq: t.seq,
                speaker: t.speaker,
                text: t.text,
                at: t.at,
                latencySec: t.latencySec,
            })),
            eventLog: Array.isArray(interview.sessionEvents) ? interview.sessionEvents : [],
            peers: peerRows.map((p: any) => ({
                id: p.id,
                candidateName: p.candidateName,
                status: p.status,
                overall: p.report?.verdict?.overall ?? null,
                suggestion: p.report?.verdict?.suggestion ?? null,
                factors: p.report?.factors
                    ? {
                        answers: p.report.factors.answers?.score ?? null,
                        resumeMatch: p.report.factors.resumeMatch?.score ?? null,
                        authenticity: p.report.factors.authenticity?.score ?? null,
                        video: p.report.factors.video?.score ?? null,
                    }
                    : null,
                humanDecision: p.humanDecision?.decision ?? null,
            })),
        });
    } catch (error: any) {
        console.error("Result error:", error?.message);
        res.status(500).json({ error: error.message });
    }
})

router.get("/recording/:interviewId", async (req, res) => {
    try {
        const interview = await prisma.interview.findUnique({ where: { id: req.params.interviewId } });
        if (!interview?.recordingData) {
            res.status(404).json({ message: "No recording available" });
            return;
        }
        const buf = Buffer.from(interview.recordingData, 'base64');
        res.setHeader('Content-Type', 'video/webm');
        res.setHeader('Content-Length', String(buf.length));
        res.status(200).send(buf);
    } catch (err: any) {
        res.status(500).json({ message: "Internal server error" });
    }
})

export default router;
