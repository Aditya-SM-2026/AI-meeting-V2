import { callGeminiJson } from './gemini.js';
import type { InterviewPlan } from './plan.js';
import type { VideoFactor } from './video.js';

const GRADER_MODEL = 'gemini-3.1-flash-lite';

export interface Turn {
    seq: number;
    speaker: 'Candidate' | 'Interviewer';
    text: string;
    at: Date | string;
    latencySec: number | null;
}

export interface CompetencyScore {
    name: string;
    weight: number;
    status: 'scored' | 'not_assessed' | 'insufficient_evidence';
    score: number | null;
    rationale: string;
    quotes: { turn: number; quote: string }[];
    gaps: string[];
    secondScore: number | null;
    judgesAgree: boolean | null;
}

export interface ResumeClaim {
    claim: string;
    verdict: 'confirmed' | 'partly_supported' | 'not_supported' | 'not_discussed';
    note: string;
    turns: number[];
}

export interface AuthSignal {
    source: 'measured' | 'grader';
    severity: 1 | 2 | 3;
    turn: number | null;
    note: string;
}

export interface Scorecard {
    generatedAt: string;
    model: string;
    verdict: {
        summary: string;
        strengths: string[];
        concerns: string[];
        overall: number | null;
        suggestion: 'strong' | 'positive' | 'mixed' | 'weak' | 'insufficient';
        needsHumanReview: boolean;
        reviewReasons: string[];
    };
    competencies: CompetencyScore[];
    competencyMean: number | null;
    factors: {
        answers: { score: number | null; note: string };
        resumeMatch: { score: number | null; note: string; claims: ResumeClaim[] };
        authenticity: { score: number | null; signals: AuthSignal[] };
        video: VideoFactor;
    };
    integritySignals: {
        tabHiddenCount: number;
        tabHiddenSec: number;
        blurCount: number;
        disconnects: number;
        medianResponseLatencySec: number | null;
        advisories: { turn: number | null; note: string }[];
    };
    dataQualityNotes: string[];
}

interface GraderPass {
    competencies: any[];
    resumeClaims: any[];
    authenticitySignals: any[];
    verdictSummary: string;
    strengths: string[];
    concerns: string[];
}

function norm(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function transcriptForGrader(turns: Turn[]): string {
    return turns
        .map((t) => `T${t.seq} ${t.speaker.toUpperCase()}${t.latencySec !== null ? ` (+${t.latencySec.toFixed(1)}s)` : ''}: ${t.text.slice(0, 700)}`)
        .join('\n')
        .slice(0, 16000);
}

async function runGraderPass(turns: Turn[], plan: InterviewPlan, resumeText: string, jd: string, pass: number): Promise<GraderPass> {
    const compList = plan.competencies
        .map((c) => `- ${c.name} (weight ${c.weight}): probe examples: ${c.probes.join(' / ')}. A 1/5 answer: ${c.anchorLow} A 5/5 answer: ${c.anchorHigh}`)
        .join('\n');

    const prompt = [
        `You are grader #${pass}, an independent interview evaluator. Grade this 5-minute AI-conducted voice interview.`,
        `The interviewer deliberately mixed technical, common-sense and personal-preference questions and reworded revisits.`,
        ``,
        `COMPETENCY PLAN (grade exactly these):`,
        compList,
        ``,
        `RESUME:`,
        resumeText.slice(0, 3000) || '(none)',
        ``,
        `JOB DESCRIPTION:`,
        jd.slice(0, 2000) || '(none)',
        ``,
        `TRANSCRIPT (T<n> = turn number, (+Xs) = seconds since interviewer finished speaking when candidate started):`,
        transcriptForGrader(turns),
        ``,
        `RULES:`,
        `- Every quote you cite MUST be a VERBATIM substring of the cited turn's text (T<n>). Never paraphrase quotes.`,
        `- Competency status: "scored" (1-5 using the anchors), "not_assessed" (interview never probed it), "insufficient_evidence" (probed but too thin to judge).`,
        `- Resume claims: pick the 3-8 strongest checkable claims from the resume; verdict confirmed | partly_supported | not_supported | not_discussed, with supporting turn numbers.`,
        `- Authenticity signals: things suggesting the answer was read from AI/notes or inconsistent (sounds read-out, AI-assisted phrasing, contradicting details, suspiciously instant fluent essays). severity 1-3 (3 = strongest). If none, empty array.`,
        ``,
        `Respond with ONLY minified JSON:`,
        `{"competencies": [{"name": "<exact plan name>", "status": "<scored|not_assessed|insufficient_evidence>", "score": <1-5 or null>,`,
        ` "rationale": "<2-3 sentences>", "quotes": [{"turn": <n>, "quote": "<verbatim>"}], "gaps": ["<what a stronger answer would have contained>"]}],`,
        ` "resumeClaims": [{"claim": "<claim text>", "verdict": "<...>", "note": "<one line>", "turns": [<n>,...]}],`,
        ` "authenticitySignals": [{"severity": <1-3>, "turn": <n or null>, "note": "<...>"}],`,
        ` "verdictSummary": "<3-4 sentence overall read>", "strengths": ["..."], "concerns": ["..."]}`,
    ].join('\n');

    const raw = await callGeminiJson(prompt, pass === 1 ? 0.2 : 0.55, GRADER_MODEL);

    return {
        competencies: Array.isArray(raw.competencies) ? raw.competencies : [],
        resumeClaims: Array.isArray(raw.resumeClaims) ? raw.resumeClaims : [],
        authenticitySignals: Array.isArray(raw.authenticitySignals) ? raw.authenticitySignals : [],
        verdictSummary: String(raw.verdictSummary || ''),
        strengths: Array.isArray(raw.strengths) ? raw.strengths.map(String).slice(0, 6) : [],
        concerns: Array.isArray(raw.concerns) ? raw.concerns.map(String).slice(0, 6) : [],
    };
}

export function verifyCitations(turns: Turn[], comps: any[]): { withdrawn: number; notes: string[] } {
    const notes: string[] = [];
    let withdrawn = 0;
    const normTurns = turns.map((t) => norm(t.text));

    for (const c of comps) {
        const valid: { turn: number; quote: string }[] = [];
        for (const q of c.quotes || []) {
            const qn = norm(String(q.quote || ''));
            if (!qn || qn.length < 8) continue;
            const cited = Number(q.turn);
            const atCited = turns[cited - 1] && normTurns[cited - 1].includes(qn);
            if (atCited) { valid.push({ turn: cited, quote: q.quote }); continue; }
            const found = normTurns.findIndex((t) => t.includes(qn));
            if (found >= 0) { valid.push({ turn: found + 1, quote: q.quote }); continue; }
            notes.push(`Citation withdrawn from "${c.name}": quote not found in transcript (T${cited}).`);
        }
        c.quotes = valid;
        if (c.status === 'scored' && valid.length === 0) {
            c.status = 'insufficient_evidence';
            c.score = null;
            c.rationale += ' [Score withdrawn: no citation could be verified against the transcript.]';
            withdrawn++;
        }
    }
    return { withdrawn, notes };
}

export function computeIntegritySignals(
    turns: Turn[],
    sessionEvents: any,
    sessionMetrics: any
): Scorecard['integritySignals'] & { measuredSignals: AuthSignal[] } {
    const events: any[] = Array.isArray(sessionEvents) ? sessionEvents : [];
    const tabHidden = events.filter((e) => e.type === 'tab_hidden');
    const blur = events.filter((e) => e.type === 'window_blur');
    const disconnects = events.filter((e) => e.type === 'disconnect');
    const tabHiddenSec = tabHidden.reduce((acc, e) => acc + (Number(e.durationSec) || 0), 0);

    const measuredLatencies: number[] | undefined = Array.isArray(sessionMetrics?.latencySamples)
        ? sessionMetrics.latencySamples.map(Number).filter((n: number) => Number.isFinite(n))
        : undefined;
    const turnLatencies = turns.filter((t) => t.speaker === 'Candidate' && t.latencySec !== null).map((t) => t.latencySec!);
    const latencies = measuredLatencies && measuredLatencies.length >= 3 ? measuredLatencies : turnLatencies;
    const median = latencies.length
        ? Math.round(medianOf(latencies) * 10) / 10
        : null;

    const measuredSignals: AuthSignal[] = [];
    if (median !== null && latencies.length >= 4 && median < 1.2) {
        measuredSignals.push({ source: 'measured', severity: 2, turn: null, note: `Median response latency ${median}s across ${latencies.length} answers is unusually fast for spoken answers.` });
    }
    if (latencies.length >= 5) {
        const spread = Math.max(...latencies) - Math.min(...latencies);
        if (spread < 1.0) {
            measuredSignals.push({ source: 'measured', severity: 1, turn: null, note: `Response latencies barely vary (spread ${spread.toFixed(1)}s) — mechanical timing.` });
        }
    }
    if (tabHidden.length >= 2) {
        measuredSignals.push({ source: 'measured', severity: 2, turn: null, note: `Candidate switched away from the tab ${tabHidden.length} times (${Math.round(tabHiddenSec)}s hidden).` });
    }
    if (tabHidden.length === 1 && tabHiddenSec > 10) {
        measuredSignals.push({ source: 'measured', severity: 1, turn: null, note: `Candidate kept the interview tab hidden for ${Math.round(tabHiddenSec)}s.` });
    }
    if (blur.length >= 2) {
        measuredSignals.push({ source: 'measured', severity: 1, turn: null, note: `Window lost focus ${blur.length} times during the interview.` });
    }
    if (disconnects.length >= 1) {
        measuredSignals.push({ source: 'measured', severity: 1, turn: null, note: `Connection dropped ${disconnects.length} time(s) mid-interview.` });
    }

    const advisories: { turn: number | null; note: string }[] = [];
    if (median !== null && median < 1.2) advisories.push({ turn: null, note: 'Check early turns T2-T4 for instant answers.' });
    for (const t of turns) {
        if (t.speaker === 'Candidate' && t.latencySec !== null && t.latencySec < 0.8 && t.text.length > 120) {
            advisories.push({ turn: t.seq, note: `Long, fluent answer started ${t.latencySec.toFixed(1)}s after the question ended.` });
        }
    }
    if (!events.length) advisories.push({ turn: null, note: 'No client telemetry was received for this session.' });

    return {
        tabHiddenCount: tabHidden.length,
        tabHiddenSec: Math.round(tabHiddenSec),
        blurCount: blur.length,
        disconnects: disconnects.length,
        medianResponseLatencySec: median,
        advisories: advisories.slice(0, 10),
        measuredSignals,
    };
}

export async function buildScorecard(input: {
    turns: Turn[];
    plan: InterviewPlan;
    resumeText: string;
    jobDescription: string;
    sessionEvents: any;
    sessionMetrics: any;
    videoFactor: VideoFactor;
    interviewDurationSec: number;
}): Promise<Scorecard> {
    const { turns, plan, resumeText, jobDescription, sessionEvents, sessionMetrics, videoFactor } = input;

    const [pass1, pass2] = await Promise.all([
        runGraderPass(turns, plan, resumeText, jobDescription, 1),
        runGraderPass(turns, plan, resumeText, jobDescription, 2),
    ]);

    const byName = new Map<string, any>();
    for (const c of pass2.competencies) byName.set(norm(String(c.name)), c);

    const comps: CompetencyScore[] = plan.competencies.map((pc) => {
        const c1 = pass1.competencies.find((c: any) => norm(String(c.name)) === norm(pc.name)) || {};
        const c2 = byName.get(norm(pc.name)) || {};
        const status = ['scored', 'not_assessed', 'insufficient_evidence'].includes(c1.status) ? c1.status : 'not_assessed';
        const score = status === 'scored' ? clampScore(c1.score) : null;
        const secondScore = (c2.status === 'scored') ? clampScore(c2.score) : null;
        const judgesAgree = score !== null && secondScore !== null ? Math.abs(score - secondScore) <= 1 : null;
        return {
            name: pc.name,
            weight: pc.weight,
            status,
            score,
            rationale: String(c1.rationale || ''),
            quotes: Array.isArray(c1.quotes) ? c1.quotes : [],
            gaps: Array.isArray(c1.gaps) ? c1.gaps.map(String).slice(0, 4) : [],
            secondScore,
            judgesAgree,
        };
    });

    const verification = verifyCitations(turns, comps);

    const scored = comps.filter((c) => c.status === 'scored' && c.score !== null);
    let timeWeightedSum = 0;
    let weightSum = 0;
    for (const c of scored) {
        timeWeightedSum += (c.score! / 5) * c.weight;
        weightSum += c.weight;
    }
    const competencyMean = weightSum > 0 ? Math.round((timeWeightedSum / weightSum) * 100) : null;

    // Factor 1 — answer quality
    const answers = {
        score: competencyMean,
        note: scored.length
            ? `Time-weighted mean of ${scored.length} scored competencies.`
            : 'No competency could be scored.',
    };

    // Factor 2 — resume match
    const claims: ResumeClaim[] = (pass1.resumeClaims || []).slice(0, 8).map((c: any) => {
        const verdict = ['confirmed', 'partly_supported', 'not_supported', 'not_discussed'].includes(c.verdict)
            ? c.verdict
            : 'not_discussed';
        const validTurns = (Array.isArray(c.turns) ? c.turns : [])
            .map(Number)
            .filter((n) => n >= 1 && n <= turns.length && turns[n - 1].speaker === 'Candidate');
        return {
            claim: String(c.claim || '').slice(0, 200),
            verdict,
            note: String(c.note || '').slice(0, 200),
            turns: validTurns,
        };
    });
    const discussed = claims.filter((c) => c.verdict !== 'not_discussed');
    const claimScore = discussed.length
        ? Math.round(discussed.reduce((acc, c) => acc + (c.verdict === 'confirmed' ? 100 : c.verdict === 'partly_supported' ? 60 : 0), 0) / discussed.length)
        : null;
    const resumeMatch = {
        score: claimScore,
        note: claimScore === null
            ? 'No resume claims were actually discussed in the interview.'
            : `Score over ${discussed.length} discussed claim(s); ${claims.length - discussed.length} not discussed.`,
        claims,
    };

    // Factor 3 — authenticity
    const integrity = computeIntegritySignals(turns, sessionEvents, sessionMetrics);
    const graderSignals: AuthSignal[] = (pass1.authenticitySignals || []).slice(0, 10).map((s: any) => ({
        source: 'grader' as const,
        severity: (Math.min(3, Math.max(1, Number(s.severity) || 1)) as 1 | 2 | 3),
        turn: s.turn && Number(s.turn) >= 1 && Number(s.turn) <= turns.length ? Number(s.turn) : null,
        note: String(s.note || ''),
    }));
    const allSignals = [...integrity.measuredSignals, ...graderSignals];
    const penalty = allSignals.reduce((acc, s) => acc + (s.source === 'measured' ? 20 : 15) * s.severity, 0);
    const authenticityScore = turns.length < 3 ? null : Math.max(0, Math.min(100, 100 - penalty));
    const authenticity = { score: authenticityScore, signals: allSignals };

    // Overall
    const weightedParts: { value: number; weight: number }[] = [];
    if (answers.score !== null) weightedParts.push({ value: answers.score, weight: 0.4 });
    if (resumeMatch.score !== null) weightedParts.push({ value: resumeMatch.score, weight: 0.2 });
    if (authenticity.score !== null) weightedParts.push({ value: authenticity.score, weight: 0.25 });
    if (videoFactor.score !== null) weightedParts.push({ value: videoFactor.score, weight: 0.15 });
    const wSum = weightedParts.reduce((a, p) => a + p.weight, 0);
    const overall = wSum > 0
        ? Math.round(weightedParts.reduce((a, p) => a + p.value * p.weight, 0) / wSum)
        : null;

    const scoredCount = scored.length;
    let suggestion: Scorecard['verdict']['suggestion'];
    if (overall === null || scoredCount < 2 || turns.filter((t) => t.speaker === 'Candidate').length < 3) {
        suggestion = 'insufficient';
    } else if (overall >= 75) suggestion = 'strong';
    else if (overall >= 60) suggestion = 'positive';
    else if (overall >= 40) suggestion = 'mixed';
    else suggestion = 'weak';

    // needsHumanReview
    const reviewReasons: string[] = [];
    if (comps.some((c) => c.judgesAgree === false)) reviewReasons.push('The two independent graders disagreed by more than 1 point on at least one competency.');
    if (verification.withdrawn > 0) reviewReasons.push(`${verification.withdrawn} competency score(s) withdrawn because cited evidence did not match the transcript.`);
    if (scoredCount < 2) reviewReasons.push('Fewer than 2 competencies could be scored.');

    // Data quality
    const dq: string[] = [];
    if (input.interviewDurationSec > 0 && input.interviewDurationSec < 240) dq.push(`Interview ran only ${Math.round(input.interviewDurationSec / 60)} min ${Math.round(input.interviewDurationSec % 60)}s — shorter than the planned 5 minutes.`);
    if (plan.fallback) dq.push('The auto-generated interview plan failed, so a generic fallback plan was used.');
    if (!sessionEvents || (Array.isArray(sessionEvents) && sessionEvents.length === 0)) dq.push('No client telemetry (tab/blur/disconnect events) was recorded.');
    if (videoFactor.status === 'no_recording') dq.push('No camera recording/frames were available, so the video factor is missing.');
    for (const n of verification.notes.slice(0, 4)) dq.push(n);

    return {
        generatedAt: new Date().toISOString(),
        model: GRADER_MODEL,
        verdict: {
            summary: pass1.verdictSummary,
            strengths: pass1.strengths,
            concerns: pass1.concerns,
            overall,
            suggestion,
            needsHumanReview: reviewReasons.length > 0,
            reviewReasons,
        },
        competencies: comps,
        competencyMean,
        factors: { answers, resumeMatch, authenticity, video: videoFactor },
        integritySignals: {
            tabHiddenCount: integrity.tabHiddenCount,
            tabHiddenSec: integrity.tabHiddenSec,
            blurCount: integrity.blurCount,
            disconnects: integrity.disconnects,
            medianResponseLatencySec: integrity.medianResponseLatencySec,
            advisories: integrity.advisories,
        },
        dataQualityNotes: dq,
    };
}

function clampScore(v: any): number | null {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(5, Math.max(1, Math.round(n)));
}

function medianOf(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}