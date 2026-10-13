import prisma from '../lib/prisma.js';
import { buildScorecard, type Turn } from '../lib/grader.js';
import { analyzeRecordingForInterview, type VideoFactorResult } from '../lib/videoAnalysis.js';

export async function loadTurns(interviewId: string): Promise<(Turn & { startedAt: Date; endedAt: Date })[]> {
    const messages = await prisma.message.findMany({
        where: { interviewId },
        orderBy: { createdAt: 'asc' },
    });

    const turns: (Turn & { startedAt: Date; endedAt: Date })[] = [];
    let prevAssistanceAt: number | null = null;
    messages.forEach((m, i) => {
        const at = m.createdAt;
        let latencySec: number | null = null;
        if (m.type === 'User' && prevAssistanceAt !== null) {
            latencySec = Math.max(0, (at.getTime() - prevAssistanceAt) / 1000);
        }
        turns.push({
            seq: i + 1,
            speaker: m.type === 'User' ? 'Candidate' : 'Interviewer',
            text: m.message,
            at,
            latencySec,
            startedAt: m.startedAt || at,
            endedAt: m.endedAt || at,
        });
        if (m.type === 'Assistance') prevAssistanceAt = at.getTime();
    });

    return turns;
}

// Concurrent generation for the same interview shares a single promise.
const inFlight = new Map<string, Promise<any | null>>();

export function generateScorecardFor(interviewId: string): Promise<any | null> {
    const existing = inFlight.get(interviewId);
    if (existing) return existing;
    const job = generateScorecardInner(interviewId).finally(() => inFlight.delete(interviewId));
    inFlight.set(interviewId, job);
    return job;
}

async function generateScorecardInner(interviewId: string): Promise<any | null> {
    // Double-check the cache after acquiring the slot — another request may
    // have finished while this one was queued.
    const fresh = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (fresh?.report) return fresh.report;

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) return null;

    const turns = await loadTurns(interviewId);
    if (turns.length === 0) return null;

    const plan: any = interview.plan || {
        roleTitle: 'Interview',
        difficulty: 'medium',
        plannedDurationSec: 300,
        fallback: true,
        competencies: [],
    };

    const durationSec = interview.startedAt && interview.completedAt
        ? (interview.completedAt.getTime() - interview.startedAt.getTime()) / 1000
        : 0;

    const videoFactor: VideoFactorResult = await analyzeRecordingForInterview(interviewId);

    const scorecard = await buildScorecard({
        turns,
        plan,
        resumeText: interview.resumeText || '',
        jobDescription: interview.jobDescription || '',
        sessionEvents: interview.sessionEvents,
        sessionMetrics: interview.sessionMetrics,
        videoFactor,
        interviewDurationSec: durationSec,
    });

    await prisma.interview.update({
        where: { id: interviewId },
        data: { report: scorecard as any, reportModel: scorecard.model },
    });

    return scorecard;
}