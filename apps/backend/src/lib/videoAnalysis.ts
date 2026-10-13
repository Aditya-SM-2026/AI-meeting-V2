import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { z } from 'zod';
import prisma from './prisma.js';
import { loadTurns } from '../routes/scorecard.js';
import {
    listRecordings,
    pickRecording,
    waitForRecordingFinished,
    makeSeekableCopy,
    recordingPath,
    ffmpegPath,
} from './recordingStore.js';

export const VIDEO_MODEL = 'gemini-3.1-flash-lite';
const SEGMENT_SECONDS = 150;
const MAX_PARALLEL_SEGMENTS = 3;
const SEGMENT_TIMEOUT_MS = 180_000;
const MIN_ANSWER_SECONDS = 8;

const MOMENT_PENALTY: Record<string, number> = {
    looking_away: 8,
    reading: 10,
    other_person: 18,
    second_device: 22,
    left_frame: 12,
    other: 6,
};

const GAZE_DIRS = ['centre', 'up', 'down', 'left', 'right', 'up_left', 'up_right', 'down_left', 'down_right', 'unclear'];
const MOMENT_KINDS = ['looking_away', 'reading', 'other_person', 'second_device', 'left_frame', 'other'];

/* ---------------- turn scheduling on the recording clock ---------------- */

interface RecAnswer {
    turnSeq: number;
    startSec: number;
    endSec: number;
    questionStartSec: number;
    durationSec: number;
    textPreview: string;
}

function buildAnswerSchedule(turns: TurnLike[], clock: ClockMapper): RecAnswer[] {
    const answers: RecAnswer[] = [];
    let prevQuestionStart: number | null = null;

    for (const t of turns) {
        const startSec = clock(t.startedAt);
        const endSec = clock(t.endedAt);
        if (startSec === null || endSec === null) continue;
        if (t.speaker === 'Interviewer') {
            prevQuestionStart = startSec;
            continue;
        }
        const questionStart = prevQuestionStart ?? Math.max(0, startSec - 8);
        answers.push({
            turnSeq: t.seq,
            startSec,
            endSec,
            questionStartSec: questionStart,
            durationSec: Math.max(0, endSec - startSec),
            textPreview: t.text.slice(0, 160),
        });
        prevQuestionStart = null; // consumed — next interviewer turn resets it
    }
    return answers;
}

interface TurnLike {
    seq: number;
    speaker: 'Candidate' | 'Interviewer';
    text: string;
    startedAt: Date;
    endedAt: Date;
}

interface ClockMapper {
    (at: Date): number | null; // server time → seconds on the recording clock (null = before recording)
}

function clockMapperFromMeta(meta: any): ClockMapper {
    // Preferred: first accepted chunk ties client-measured elapsed to server time,
    // which corrects any clock skew between the browser and the server.
    const firstChunkAt = meta?.firstChunkAt ? new Date(meta.firstChunkAt).getTime() : null;
    const firstChunkElapsedMs = Number(meta?.firstChunkElapsedMs ?? 0);

    // Fallback: the recording_started anchor from the event log.
    const anchor = meta?.anchorStartedAt ? new Date(meta.anchorStartedAt).getTime() : null;
    const epoch = firstChunkAt ?? anchor;

    if (!epoch) {
        return () => null;
    }
    return (at: Date) => {
        const ms = firstChunkAt
            ? firstChunkElapsedMs + (at.getTime() - firstChunkAt)
            : at.getTime() - anchor;
        if (ms < -1500) return null; // before the camera started
        return Math.max(0, ms / 1000);
    };
}

/* ---------------- cutting ---------------- */

async function cutSegments(ff: string, playPath: string, outDir: string): Promise<{ file: string; startSec: number; durationSec: number }[]> {
    await fsp.mkdir(outDir, { recursive: true });
    const pattern = path.join(outDir, 'seg%03d.mp4');
    await new Promise<void>((resolve, reject) => {
        execFile(ff, [
            '-y', '-i', playPath,
            '-an',
            '-vf', 'fps=2,scale=640:-2',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
            '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
            '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-reset_timestamps', '1',
            pattern,
        ], { timeout: 300_000 }, (err) => (err ? reject(err) : resolve()));
    });

    const files = (await fsp.readdir(outDir)).filter((f) => /^seg\d+\.mp4$/.test(f)).sort();
    return files.map((f, i) => ({
        file: path.join(outDir, f),
        startSec: i * SEGMENT_SECONDS,
        durationSec: SEGMENT_SECONDS,
    }));
}

/* ---------------- provider chain ---------------- */

async function analyzeSegmentWithProvider(
    segment: { file: string; startSec: number; durationSec: number },
    schedule: RecAnswer[]
): Promise<SegmentAnalysis | null> {
    const bytes = await fsp.readFile(segment.file);
    if (bytes.length === 0) return null;
    const b64 = bytes.toString('base64');
    const mime = 'video/mp4';

    const clipAnswers = schedule.filter((a) => {
        const middle = (a.startSec + a.endSec) / 2;
        return middle >= segment.startSec && middle < segment.startSec + segment.durationSec;
    });

    const providers: ((b64: string, mime: string) => Promise<any>)[] = [];
    if (process.env.OMNIBOT_API_KEY && process.env.OMNIBOT_VISION_URL) {
        providers.push(omnibotVision);
    }
    providers.push((b, m) => geminiVideo(b, m));

    for (const provider of providers) {
        try {
            const raw = await withTimeout(provider(b64, mime), SEGMENT_TIMEOUT_MS);
            const parsed = SegmentSchema.parse(raw);
            return normalizeSegment(parsed, segment);
        } catch (err: any) {
            console.error(`[video] segment @${segment.startSec}s failed:`, String(err?.message || err).slice(0, 200));
            continue; // malformed reply → next provider → else segment skipped
        }
    }
    return null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('segment timeout')), ms)),
    ]);
}

async function geminiVideo(b64: string, mime: string): Promise<any> {
    const key = process.env.API_KEY;
    if (!key) throw new Error('no vision key');
    const prompt = buildSegmentPrompt();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${VIDEO_MODEL}:generateContent?key=${key}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                role: 'user',
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: mime, data: b64 } },
                ],
            }],
            generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
    return JSON.parse(text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim());
}

async function omnibotVision(b64: string, mime: string): Promise<any> {
    // Wired when an OmniBot vision key is supplied (OMNIBOT_API_KEY + OMNIBOT_VISION_URL).
    const res = await fetch(process.env.OMNIBOT_VISION_URL!, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OMNIBOT_API_KEY}`,
        },
        body: JSON.stringify({
            model: process.env.OMNIBOT_VISION_MODEL || 'vision',
            messages: [
                { role: 'user', content: [
                    { type: 'text', text: buildSegmentPrompt() },
                    { type: 'video_url', video_url: `data:${mime};base64,${b64}` },
                ] },
            ],
        }),
    });
    if (!res.ok) throw new Error(`omnibot ${res.status}`);
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? data?.content ?? '';
    const t = typeof text === 'string' ? text : JSON.stringify(text);
    return JSON.parse(t.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim());
}

function buildSegmentPrompt(): string {
    return [
        `You analyse silent low-framerate webcam footage of a candidate during a REMOTE VOICE interview.`,
        `The candidate could be reading answers aloud from an AI tool on a phone or a second screen kept off-camera.`,
        ``,
        `The question that matters is NOT whether they ever look away — it is whether they keep returning to the`,
        `same off-screen spot WHILE ANSWERING, and not while listening. Natural glance-aways are normal.`,
        ``,
        `A schedule of the answers that fall in this clip is provided below. For each answer, judge:`,
        `- whileListening: gaze direction while the INTERVIEWER asks the question (use the seconds just before the answer starts).`,
        `- whileAnswering: gaze direction while the CANDIDATE speaks.`,
        `  One of: ${GAZE_DIRS.join('|')}. Use "unclear" if you cannot tell.`,
        `- steady: true only if whileAnswering held ONE clearly non-centre direction for most of the answer.`,
        `- reading: true only if you see line-by-line eye movement, lips tracking text, or obvious reading behaviour.`,
        `- note: one concrete sentence.`,
        ``,
        `Also report suspicious MOMENTS visible anywhere in the clip: kind one of ${MOMENT_KINDS.join('|')},`,
        `at given as "m:ss" (clip-relative), durationSeconds, description.`,
        ``,
        `Respond with ONLY minified JSON:`,
        `{"answers":[{"turnSeq":<n>,"whileListening":"<dir>","whileAnswering":"<dir>","steady":<bool>,"reading":<bool>,"note":"<...>"}],`,
        ` "moments":[{"at":"m:ss","durationSeconds":<n>,"kind":"<kind>","description":"<...>"}]}`,
        `Include every scheduled turnSeq you can see. Skip ones not observable.`,
    ].join('\n');
}

const SegmentSchema = z.object({
    answers: z.array(z.object({
        turnSeq: z.number(),
        whileListening: z.string().optional().default('unclear'),
        whileAnswering: z.string().optional().default('unclear'),
        steady: z.boolean().optional().default(false),
        reading: z.boolean().optional().default(false),
        note: z.string().optional().default(''),
    })).default([]),
    moments: z.array(z.object({
        at: z.union([z.string(), z.number()]),
        durationSeconds: z.number().optional().default(0),
        kind: z.string(),
        description: z.string().optional().default(''),
    })).default([]),
});

export interface SegmentAnswer {
    turnSeq: number;
    whileListening: string;
    whileAnswering: string;
    steady: boolean;
    reading: boolean;
    note: string;
}

export interface SegmentMoment {
    atSeconds: number;
    durationSeconds: number;
    kind: string;
    description: string;
}

interface SegmentAnalysis {
    answers: SegmentAnswer[];
    moments: SegmentMoment[];
}

function parseTimeToSeconds(v: string | number): number {
    if (typeof v === 'number') return v;
    const parts = String(v).split(':').map((s) => parseFloat(s) || 0);
    return parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts.length === 2
            ? parts[0] * 60 + parts[1]
            : parts[0] || 0;
}

function normalizeSegment(parsed: z.infer<typeof SegmentSchema>, segment: { startSec: number; durationSec: number }): SegmentAnalysis {
    const windowEnd = segment.startSec + segment.durationSec;
    return {
        answers: parsed.answers
            .filter((a) => GAZE_DIRS.includes(a.whileListening) || GAZE_DIRS.includes(a.whileAnswering))
            .map((a) => ({
                turnSeq: a.turnSeq,
                whileListening: GAZE_DIRS.includes(a.whileListening) ? a.whileListening : 'unclear',
                whileAnswering: GAZE_DIRS.includes(a.whileAnswering) ? a.whileAnswering : 'unclear',
                steady: a.steady,
                reading: a.reading,
                note: a.note.slice(0, 300),
            })),
        moments: parsed.moments
            .map((m) => {
                const at = parseTimeToSeconds(m.at) + segment.startSec; // clip-relative → absolute
                return {
                    atSeconds: Math.max(segment.startSec, Math.min(windowEnd - 1, Math.round(at))),
                    durationSeconds: Math.max(1, Math.min(segment.durationSec, Math.round(m.durationSeconds))),
                    kind: MOMENT_KINDS.includes(m.kind) ? m.kind : 'other',
                    description: m.description.slice(0, 300),
                };
            }),
    };
}

/* ---------------- scoring — computed in code, never by the model ---------------- */

function mode(values: string[]): string | null {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    let best: string | null = null;
    let bestN = 1;
    for (const [v, n] of counts) {
        if (n > bestN) { best = v; bestN = n; }
    }
    return best;
}

export function gazePattern(answers: SegmentAnswer[], schedule: RecAnswer[]) {
    const durationByTurn = new Map(schedule.map((a) => [a.turnSeq, a.durationSec]));
    const judged = answers.filter((a) =>
        (durationByTurn.get(a.turnSeq) ?? 0) >= MIN_ANSWER_SECONDS && a.whileAnswering !== 'unclear'
    );
    const listening = judged.map((a) => a.whileListening).filter((d) => d !== 'unclear');
    const listeningDirection = listening.length >= 2 ? mode(listening) : null;
    const offScreen = judged.filter(
        (a) => a.steady && a.whileAnswering !== 'centre' && a.whileAnswering !== listeningDirection
    );
    const direction = offScreen.length >= 2 ? mode(offScreen.map((a) => a.whileAnswering)) : null;
    const sameSpotAnswers = direction ? offScreen.filter((a) => a.whileAnswering === direction).length : 0;
    const readingAnswers = judged.filter((a) => a.reading).length;

    return {
        answersObserved: answers.length,
        judgedCount: judged.length,
        listeningDirection,
        heldOffScreenDirection: direction,
        sameSpotAnswers,
        readingAnswers,
        sentence: direction && sameSpotAnswers >= 2
            ? `Looked ${direction.replace('_', '-')} off-screen while answering in ${sameSpotAnswers} of ${judged.length} judged answers (listening baseline: ${listeningDirection || 'unclear'}).`
            : `No repeated off-screen answering gaze detected across ${judged.length} judged answers.`,
    };
}

export function videoBehaviourScore(
    moments: SegmentMoment[],
    tabHidden: { count: number; seconds: number },
    pattern: ReturnType<typeof gazePattern>
): number {
    let score = 100;
    for (const m of moments) {
        score -= (MOMENT_PENALTY[m.kind] ?? 6) + Math.min(6, m.durationSeconds / 10);
    }
    if (pattern.sameSpotAnswers >= 2 && pattern.judgedCount > 0) {
        score -= 60 * (pattern.sameSpotAnswers / pattern.judgedCount);
    }
    score -= Math.min(30, pattern.readingAnswers * 10);
    score -= Math.min(30, tabHidden.count * 4 + tabHidden.seconds / 6);
    return Math.max(0, Math.min(100, Math.round(score)));
}

/* ---------------- the service ---------------- */

export interface VideoFactorResult {
    status: 'analysed' | 'no_recording' | 'not_configured' | 'failed';
    reason?: string;
    model?: string;
    score: number | null;
    attentionPct: number | null;
    recordingId?: string;
    recordingUrl?: string | null;
    moments: SegmentMoment[];
    answers: (SegmentAnswer & { durationSec: number })[];
    gazePattern: ReturnType<typeof gazePattern>;
    segmentsAnalysed: number;
    segmentsSkipped: number;
    summary?: string;
}

export async function analyzeRecordingForInterview(interviewId: string): Promise<VideoFactorResult> {
    const empty = (status: VideoFactorResult['status'], reason: string): VideoFactorResult => ({
        status, reason, score: null, attentionPct: null,
        moments: [], answers: [],
        gazePattern: { answersObserved: 0, judgedCount: 0, listeningDirection: null, heldOffScreenDirection: null, sameSpotAnswers: 0, readingAnswers: 0, sentence: '' },
        segmentsAnalysed: 0, segmentsSkipped: 0,
    });

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) return empty('not_configured', 'Interview not found.');

    const recordings = await listRecordings(interviewId);
    const picked = pickRecording(recordings);
    if (!picked) return empty('no_recording', 'No camera recording was uploaded for this session.');

    // Cache: same recording already analysed → reuse
    const cached = interview.videoFeedback as any;
    if (cached?.recordingId === picked.recordingId && Number(cached?.fileSize) === picked.size && cached?.factor) {
        return { ...cached.factor, recordingId: picked.recordingId };
    }

    await waitForRecordingFinished(interviewId, picked.recordingId);

    const ff = ffmpegPath();
    const { playPath, sourcePath } = await makeSeekableCopy(interviewId, picked.recordingId);
    if (!playPath && !sourcePath) return empty('failed', 'Recording file missing.');

    const meta = picked.meta || {};
    const turns = await loadTurns(interviewId);
    const clock = clockMapperFromMeta(meta);

    const turnLikes: TurnLike[] = turns.map((t) => ({
        seq: t.seq,
        speaker: t.speaker,
        text: t.text,
        startedAt: (t as any).startedAt ? new Date((t as any).startedAt) : new Date(t.at),
        endedAt: (t as any).endedAt ? new Date((t as any).endedAt) : new Date(t.at),
    }));
    const schedule = buildAnswerSchedule(turnLikes, clock);

    // Cut
    let segments: { file: string; startSec: number; durationSec: number }[] = [];
    const outDir = path.join(path.dirname(sourcePath), 'segments');
    if (ff && playPath) {
        try {
            segments = await cutSegments(ff, playPath, outDir);
        } catch (err: any) {
            console.error('[video] cut failed:', err?.message);
        }
    }
    if (!segments.length) {
        const size = picked.size;
        if (size <= 14 * 1024 * 1024) {
            segments = [{ file: sourcePath, startSec: 0, durationSec: Math.max(1, Math.round((size / 350_000) / 5)) }];
        } else {
            return empty('failed', 'Recording too large to analyse and ffmpeg unavailable.');
        }
    }

    // Analyse (parallel, max 3)
    const merged: SegmentAnalysis = { answers: [], moments: [] };
    let analysed = 0, skipped = 0;
    const queue = [...segments];
    const workers = Array.from({ length: Math.min(MAX_PARALLEL_SEGMENTS, queue.length) }, async () => {
        while (queue.length) {
            const seg = queue.shift()!;
            const result = await analyzeSegmentWithProvider(seg, schedule);
            if (result) {
                analysed++;
                merged.answers.push(...result.answers);
                merged.moments.push(...result.moments);
            } else {
                skipped++;
            }
        }
    });
    await Promise.all(workers);

    if (analysed === 0) {
        return empty('failed', 'Every video segment failed to analyse (model unavailable or malformed output).');
    }

    // dedupe answers by turnSeq (segments can overlap on boundaries)
    const byTurn = new Map<number, SegmentAnswer>();
    for (const a of merged.answers) byTurn.set(a.turnSeq, a);
    const answers = [...byTurn.values()];

    // moments: merge adjacent same-kind
    const moments = merged.moments.sort((a, b) => a.atSeconds - b.atSeconds);

    const tabHiddenEvents = (Array.isArray(interview.sessionEvents) ? interview.sessionEvents : [])
        .filter((e: any) => e.type === 'tab_hidden');
    const tabHidden = {
        count: tabHiddenEvents.length,
        seconds: tabHiddenEvents.reduce((acc: number, e: any) => acc + (Number(e.durationSec) || 0), 0),
    };

    const pattern = gazePattern(answers, schedule);
    const score = videoBehaviourScore(moments, tabHidden, pattern);
    const attentionPct = pattern.judgedCount
        ? Math.round((answers.filter((a) => a.whileAnswering === 'centre').length / Math.max(1, pattern.judgedCount)) * 100)
        : null;

    const factor: VideoFactorResult = {
        status: 'analysed',
        model: VIDEO_MODEL,
        score,
        attentionPct,
        recordingId: picked.recordingId,
        recordingUrl: `/api/v1/recordings/${interviewId}/play/${picked.recordingId}`,
        moments,
        answers: answers.map((a) => ({ ...a, durationSec: Math.round(schedule.find((s) => s.turnSeq === a.turnSeq)?.durationSec ?? 0) })),
        gazePattern: pattern,
        segmentsAnalysed: analysed,
        segmentsSkipped: skipped,
    };

    await prisma.interview.update({
        where: { id: interviewId },
        data: {
            videoFeedback: {
                recordingId: picked.recordingId,
                fileSize: picked.size,
                analyzedAt: new Date().toISOString(),
                factor: factor as any,
            } as any,
        },
    });

    return factor;
}