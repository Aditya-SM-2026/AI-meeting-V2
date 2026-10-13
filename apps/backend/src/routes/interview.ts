import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

router.post("/telemetry", async (req, res) => {
    try {
        const { interviewId, events } = req.body || {};
        if (!interviewId || !Array.isArray(events)) {
            res.status(400).json({ message: "Validation failed" });
            return;
        }
        const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
        if (!interview) {
            res.status(404).json({ message: "Interview not found" });
            return;
        }
        const clean = events.slice(0, 200).map((e: any) => ({
            type: String(e.type || 'unknown').slice(0, 40),
            at: e.at ? new Date(e.at) : new Date(),
            durationSec: Number(e.durationSec) || undefined,
            detail: e.detail ? String(e.detail).slice(0, 200) : undefined,
        }));
        await prisma.interview.update({
            where: { id: interviewId },
            data: { sessionEvents: clean as any },
        });
        res.status(200).json({ message: "Telemetry stored", count: clean.length });
    } catch (err: any) {
        console.error("Telemetry error:", err?.message);
        res.status(500).json({ message: "Internal server error" });
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

        const { listRecordings, pickRecording } = await import('../lib/recordingStore.js');
        const recList = await listRecordings(interviewId);
        const recPicked = pickRecording(recList);

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
                hasRecording: Boolean(recPicked),
                recordingId: recPicked?.recordingId ?? null,
                finished: recPicked?.finished ?? false,
                size: recPicked?.size ?? null,
                startedAt: recPicked?.meta?.anchorStartedAt ?? interview.recordingStartedAt ?? null,
                playUrl: recPicked ? `/api/v1/recordings/${interviewId}/play/${recPicked.recordingId}` : null,
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
        const { listRecordings, pickRecording } = await import('../lib/recordingStore.js');
        const list = await listRecordings(req.params.interviewId);
        const picked = pickRecording(list);
        if (!picked) {
            res.status(404).json({ message: "No recording available" });
            return;
        }
        res.status(200).json({
            recordingId: picked.recordingId,
            size: picked.size,
            finished: picked.finished,
            playUrl: `/api/v1/recordings/${req.params.interviewId}/play/${picked.recordingId}`,
        });
    } catch (err: any) {
        res.status(500).json({ message: "Internal server error" });
    }
})

export default router;