import { callGeminiJson } from './gemini.js';

export const VIDEO_MODEL = 'gemini-3.1-flash-lite';

export interface VideoFrameAnalysis {
    frame: number;
    at: number;
    onScreen: boolean;
    gaze: string;
    reading: boolean;
    kind: string;
    note: string;
}

export interface VideoFramesResult {
    summary: string;
    frames: VideoFrameAnalysis[];
}

const GAZE_DIRS = ['center', 'up', 'down', 'left', 'right', 'up_left', 'up_right', 'down_left', 'down_right'];
const KINDS = ['normal', 'looking_away', 'reading', 'other_person', 'second_device', 'left_frame', 'other'];

export async function analyzeVideoFrames(
    frames: { data: string; at?: number }[]
): Promise<VideoFramesResult> {
    const prompt = [
        `You analyze webcam frames sampled from a candidate's camera during a REMOTE VOICE interview.`,
        `For EACH frame, judge what is visible. Use these labels:`,
        `- onScreen: is the candidate's face clearly visible and on camera.`,
        `- gaze: one of ${GAZE_DIRS.join('|')} — where their eyes/face point, relative to the camera.`,
        `- reading: true only if they appear to be reading (line-by-line eye movement, lips tracking text).`,
        `- kind: one of ${KINDS.join('|')} — the dominant behavior in that frame. Use "second_device" when a phone/second screen or its glow is plausibly involved, "left_frame" when the candidate is not in frame, "normal" for attentive on-camera behavior.`,
        `- note: one short concrete sentence.`,
        ``,
        `Respond with ONLY minified JSON:`,
        `{"summary": "<2-3 sentence overall behavioral read>", "frames": [{"frame": <1-based index>, "at": <seconds>, "onScreen": <bool>, "gaze": "<dir>", "reading": <bool>, "kind": "<kind>", "note": "<...>"}]}`,
        ``,
        `You are given ${frames.length} frames, each preceded by "Frame <i> at <MM:SS>:". Repeat "at" from the label.`,
    ].join('\n');

    const parts: any[] = [{ text: prompt }];
    frames.forEach((frame, i) => {
        const at = frame.at ?? 0;
        const m = Math.floor(at / 60), s = at % 60;
        parts.push({ text: `Frame ${i + 1} at ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:` });
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: frame.data } });
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${VIDEO_MODEL}:generateContent?key=${process.env.API_KEY}`;
    const body = JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    });

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 2500 * attempt));
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });
        if (res.status === 503 || res.status === 429) {
            lastErr = new Error(`Gemini video frames request failed (${res.status}): ${await res.text()}`);
            continue;
        }
        if (!res.ok) {
            throw new Error(`Gemini video frames request failed (${res.status}): ${await res.text()}`);
        }
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
        const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim());
        return normalizeFramesResult(parsed, frames);
    }
    throw lastErr || new Error('Gemini video frames request failed');
}

function normalizeFramesResult(parsed: any, frames: { data: string; at?: number }[]): VideoFramesResult {
    const outFrames: VideoFrameAnalysis[] = (Array.isArray(parsed.frames) ? parsed.frames : [])
        .slice(0, 40)
        .map((f: any, i: number) => ({
            frame: Number(f.frame) || i + 1,
            at: Number(f.at) || frames[i]?.at || 0,
            onScreen: Boolean(f.onScreen),
            gaze: GAZE_DIRS.includes(f.gaze) ? f.gaze : 'unknown',
            reading: Boolean(f.reading),
            kind: KINDS.includes(f.kind) ? f.kind : 'other',
            note: String(f.note || ''),
        }));

    return { summary: String(parsed.summary || ''), frames: outFrames };
}

export interface VideoMoment {
    at: number;
    durationSec: number;
    kind: string;
    description: string;
}

export interface AnswerGaze {
    turn: number;
    at: number;
    framesObserved: number;
    dominantGaze: string;
    reading: boolean;
}

export interface VideoFactor {
    status: 'analysed' | 'no_recording' | 'not_configured' | 'failed';
    reason?: string;
    model?: string;
    score: number | null;
    attentionPct: number | null;
    frameCount: number;
    summary: string;
    moments: VideoMoment[];
    perAnswer: AnswerGaze[];
    gazePattern: {
        answersObserved: number;
        habitualListeningDirection: string | null;
        heldOffScreenDirection: string | null;
        sameSpotAnswerCount: number;
        readingAnswerCount: number;
    };
}

export function computeVideoFactor(
    videoData: any,
    opts: {
        recordingStartedAt?: Date | string | null;
        startedAt?: Date | string | null;
        messages: { type: string; createdAt: Date | string }[];
        totalInterviewSec: number;
    }
): VideoFactor {
    const frames: VideoFrameAnalysis[] = Array.isArray(videoData?.frames) ? videoData.frames : [];

    if (!videoData || frames.length === 0) {
        const reason = !videoData
            ? 'No camera data was uploaded for this session.'
            : 'Frame analysis returned no usable frames.';
        return {
            status: !videoData ? 'no_recording' : 'failed',
            reason,
            score: null,
            attentionPct: null,
            frameCount: 0,
            summary: videoData?.summary || '',
            moments: [],
            perAnswer: [],
            gazePattern: { answersObserved: 0, habitualListeningDirection: null, heldOffScreenDirection: null, sameSpotAnswerCount: 0, readingAnswerCount: 0 },
        };
    }

    const t0 = new Date(opts.recordingStartedAt || opts.startedAt || 0).getTime();

    // Answer windows: from previous Assistance message to the candidate's User message
    const ordered = [...opts.messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const windows: { turn: number; startSec: number; endSec: number }[] = [];
    let candidateTurn = 0;
    for (let i = 0; i < ordered.length; i++) {
        if (ordered[i].type !== 'User') continue;
        candidateTurn++;
        const prev = [...ordered.slice(0, i)].reverse().find((m) => m.type === 'Assistance');
        const startMs = prev ? new Date(prev.createdAt).getTime() : t0;
        const endMs = new Date(ordered[i].createdAt).getTime();
        windows.push({
            turn: candidateTurn,
            startSec: Math.max(0, (startMs - t0) / 1000),
            endSec: (endMs - t0) / 1000,
        });
    }

    const answerWindows = windows.filter((w) => w.endSec > w.startSec);

    // attention: on screen and not obviously distracted
    const attentive = frames.filter(
        (f) => f.onScreen && !['other_person', 'second_device', 'left_frame'].includes(f.kind)
    );
    const attentionPct = Math.round((attentive.length / frames.length) * 100);

    // moments: group consecutive suspicious frames (allow 1-frame gap)
    const suspicious = frames.filter((f) => !['normal', 'unknown'].includes(f.kind));
    const moments: VideoMoment[] = [];
    let group: VideoFrameAnalysis[] = [];
    const flush = () => {
        if (group.length >= 1) {
            const kindMode = mode(group.map((f) => f.kind)) || group[0].kind;
            const first = group[0], last = group[group.length - 1];
            const interval = medianDelta(frames) || 5;
            moments.push({
                at: Math.round(first.at),
                durationSec: Math.round(last.at - first.at + interval),
                kind: kindMode,
                description: [...new Set(group.map((f) => f.note).filter(Boolean))].join(' '),
            });
        }
        group = [];
    };
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (!['normal', 'unknown'].includes(f.kind)) {
            group.push(f);
        } else {
            const nextSuspicious = frames.slice(i + 1, i + 2).find((n) => !['normal', 'unknown'].includes(n.kind));
            if (!nextSuspicious) flush();
            else if (group.length) group.push(f); // bridge gap
        }
    }
    flush();

    // per-answer gaze
    const perAnswer: AnswerGaze[] = [];
    let sameSpotAnswers = 0;
    let readingAnswers = 0;
    for (const w of answerWindows) {
        const inWindow = frames.filter((f) => f.at >= w.startSec && f.at <= w.endSec + 3);
        if (inWindow.length === 0) continue;
        const dominant = mode(inWindow.map((f) => f.gaze)) || 'unknown';
        const readingShare = inWindow.filter((f) => f.reading).length / inWindow.length;
        const reading = readingShare >= 0.5;
        if (reading) readingAnswers++;
        if (dominant !== 'center' && dominant !== 'unknown' && GAZE_DIRS.includes(dominant)) {
            const share = inWindow.filter((f) => f.gaze === dominant).length / inWindow.length;
            if (share >= 0.6) sameSpotAnswers++;
        }
        perAnswer.push({
            turn: w.turn,
            at: Math.round(w.startSec),
            framesObserved: inWindow.length,
            dominantGaze: dominant,
            reading,
        });
    }

    // listening frames = frames outside all answer windows
    const listening = frames.filter(
        (f) => !answerWindows.some((w) => f.at >= w.startSec && f.at <= w.endSec + 3)
    );
    const habitListening = listening.length >= 2 ? mode(listening.map((f) => f.gaze)) : null;
    const offCenterAnswerFrames = frames.filter(
        (f) => answerWindows.some((w) => f.at >= w.startSec && f.at <= w.endSec + 3) &&
            f.gaze !== 'center' && f.gaze !== 'unknown'
    );
    const heldOff = offCenterAnswerFrames.length >= 2 ? mode(offCenterAnswerFrames.map((f) => f.gaze)) : null;

    // score 0-100: attention baseline minus per-moment penalties
    let score = attentionPct;
    for (const m of moments) {
        const penalty: Record<string, number> = {
            second_device: 15, other_person: 15, left_frame: 10, reading: 8, looking_away: 5, other: 5,
        };
        score -= penalty[m.kind] ?? 5;
    }
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
        status: 'analysed',
        model: VIDEO_MODEL,
        score,
        attentionPct,
        frameCount: frames.length,
        summary: String(videoData.summary || ''),
        moments,
        perAnswer,
        gazePattern: {
            answersObserved: perAnswer.length,
            habitualListeningDirection: habitListening,
            heldOffScreenDirection: heldOff,
            sameSpotAnswerCount: sameSpotAnswers,
            readingAnswerCount: readingAnswers,
        },
    };
}

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

function medianDelta(frames: VideoFrameAnalysis[]): number | null {
    if (frames.length < 2) return null;
    const deltas = frames.slice(1).map((f, i) => f.at - frames[i].at).filter((d) => d > 0).sort((a, b) => a - b);
    if (!deltas.length) return null;
    return deltas[Math.floor(deltas.length / 2)];
}