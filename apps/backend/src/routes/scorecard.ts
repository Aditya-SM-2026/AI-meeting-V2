import prisma from '../lib/prisma.js';
import { buildScorecard, type Turn } from '../lib/grader.js';
import { computeVideoFactor, type VideoFactor } from '../lib/video.js';

export async function loadTurns(interviewId: string): Promise<Turn[]> {
    const messages = await prisma.message.findMany({
        where: { interviewId },
        orderBy: { createdAt: 'asc' },
    });

    const turns: Turn[] = [];
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
        });
        if (m.type === 'Assistance') prevAssistanceAt = at.getTime();
    });

    return turns;
}

export async function generateScorecardFor(interviewId: string): Promise<any | null> {
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

    const videoFactor: VideoFactor = computeVideoFactor(interview.videoFeedback as any, {
        recordingStartedAt: interview.recordingStartedAt,
        startedAt: interview.startedAt,
        messages: turns.map((t) => ({ type: t.speaker === 'Candidate' ? 'User' : 'Assistance', createdAt: t.at })),
        totalInterviewSec: durationSec,
    });

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