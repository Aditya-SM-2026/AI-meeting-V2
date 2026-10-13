import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

/* ---------- types ---------- */

interface Competency {
    name: string;
    weight: number;
    status: "scored" | "not_assessed" | "insufficient_evidence";
    score: number | null;
    rationale: string;
    quotes: { turn: number; quote: string }[];
    gaps: string[];
    secondScore: number | null;
    judgesAgree: boolean | null;
}

interface ResumeClaim {
    claim: string;
    verdict: string;
    note: string;
    turns: number[];
}

interface AuthSignal {
    source: "measured" | "grader";
    severity: 1 | 2 | 3;
    turn: number | null;
    note: string;
}

interface VideoMoment { at: number; durationSec: number; kind: string; description: string }
interface AnswerGaze { turn: number; at: number; framesObserved: number; dominantGaze: string; reading: boolean }

interface VideoFactor {
    status: "analysed" | "no_recording" | "not_configured" | "failed";
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

interface Scorecard {
    generatedAt: string;
    model: string;
    verdict: {
        summary: string;
        strengths: string[];
        concerns: string[];
        overall: number | null;
        suggestion: "strong" | "positive" | "mixed" | "weak" | "insufficient";
        needsHumanReview: boolean;
        reviewReasons: string[];
    };
    competencies: Competency[];
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

interface TurnRow {
    seq: number;
    speaker: "Candidate" | "Interviewer";
    text: string;
    at: string;
    latencySec: number | null;
}

interface PeerRow {
    id: string;
    candidateName: string;
    status: string | null;
    overall: number | null;
    suggestion: string | null;
    factors: { answers: number | null; resumeMatch: number | null; authenticity: number | null; video: number | null } | null;
    humanDecision: string | null;
}

interface ResultData {
    candidateName: string;
    candidateEmail?: string | null;
    recruiterName?: string | null;
    status: string | null;
    roleTitle?: string | null;
    difficulty?: string | null;
    plannedDurationSec?: number | null;
    startedAt?: string | null;
    completedAt?: string | null;
    jobDescription?: string | null;
    resumeText?: string | null;
    scorecard: Scorecard | null;
    humanDecision?: { decision: string; note: string | null; decidedAt: string } | null;
    recording: { hasRecording: boolean; recordingStartedAt?: string | null; recordingUrl?: string | null };
    transcript: TurnRow[];
    eventLog: any[];
    peers: PeerRow[];
}

const FONT_LINK_ID = "interview-report-fonts";
function useReportFonts() {
    useEffect(() => {
        if (document.getElementById(FONT_LINK_ID)) return;
        const link = document.createElement("link");
        link.id = FONT_LINK_ID;
        link.rel = "stylesheet";
        link.href =
            "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500&display=swap";
        document.head.appendChild(link);
    }, []);
}

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export const Report = () => {
    useReportFonts();
    const { interviewId } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState<ResultData | null>(null);
    const [loading, setLoading] = useState(true);
    const [regenerating, setRegenerating] = useState(false);
    const [error, setError] = useState("");

    const load = async () => {
        setError("");
        try {
            const res = await axios.get<ResultData>(`${API}/api/v1/result/${interviewId}`, { timeout: 180000 });
            setData(res.data);
        } catch (err: any) {
            setError(err?.response?.data?.message || err?.message || "Couldn't load this report.");
        }
    };

    useEffect(() => {
        (async () => {
            setLoading(true);
            await load();
            setLoading(false);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [interviewId]);

    const regenerate = async () => {
        setRegenerating(true);
        try {
            await axios.post(`${API}/api/v1/interviews/${interviewId}/regenerate`, {}, { timeout: 180000 });
            await load();
        } catch (err: any) {
            setError(err?.response?.data?.message || "Regeneration failed.");
        } finally {
            setRegenerating(false);
        }
    };

    return (
        <div className="min-h-screen w-full" style={{ backgroundColor: "#F6F4EE", color: "#1E2128" }}>
            <div className="mx-auto max-w-4xl px-6 py-14">
                <button
                    onClick={() => navigate("/")}
                    className="text-xs uppercase tracking-widest"
                    style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
                >
                    ← Back to console
                </button>

                {loading && <LoadingState regenerating={regenerating} />}
                {!loading && error && <ErrorState message={error} onRetry={regenerate} retrying={regenerating} />}
                {!loading && !error && data && (
                    <ReportBody data={data} onRegenerate={regenerate} regenerating={regenerating} />
                )}
            </div>
        </div>
    );
};

function LoadingState({ regenerating }: { regenerating?: boolean }) {
    return (
        <div className="mt-10 animate-pulse">
            <h1 className="text-2xl">Grading interview…</h1>
            <p className="mt-2 text-sm" style={{ color: "#63666F" }}>
                {regenerating
                    ? "Running a fresh double-pass grade — this takes up to a minute."
                    : "Running two independent grading passes, verifying citations and computing factors — up to a minute on first view."}
            </p>
            <div className="mt-8 h-40 rounded-lg" style={{ backgroundColor: "#EFEBDF", border: "1px solid #DAD5C7" }} />
        </div>
    );
}

function ErrorState({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
    return (
        <div className="mt-10 rounded-lg px-6 py-8" style={{ backgroundColor: "#FBEEEA", border: "1px solid #E3C4B8" }}>
            <p className="text-xs font-medium uppercase tracking-widest" style={{ color: "#9C3B2E", fontFamily: "'IBM Plex Mono', monospace" }}>
                Report unavailable
            </p>
            <p className="mt-2 text-sm" style={{ color: "#63666F" }}>{message}</p>
            <button
                onClick={onRetry}
                disabled={retrying}
                className="mt-4 rounded-full px-5 py-2 text-xs uppercase tracking-widest disabled:opacity-50"
                style={{ backgroundColor: "#9C3B2E", color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}
            >
                {retrying ? "Retrying…" : "Try again"}
            </button>
        </div>
    );
}

/* ---------- report body ---------- */

function ReportBody({ data, onRegenerate, regenerating }: { data: ResultData; onRegenerate: () => void; regenerating: boolean }) {
    const card = data.scorecard;
    return (
        <div>
            <SessionHeader data={data} />
            {card && (
                <>
                    <VerdictPanel card={card} />
                    <CompetencyPanel card={card} />
                    <FactorAnswers card={card} />
                    <FactorResume card={card} />
                    <FactorAuthenticity card={card} />
                    <IntegritySignals card={card} />
                    <FactorVideo card={card} />
                </>
            )}
            <RecordingPanel data={data} />
            <TranscriptPanel data={data} />
            <EventLogPanel data={data} />
            <PeersPanel data={data} />
            <HumanDecisionPanel data={data} onSaved={() => window.location.reload()} />
            {card && <MetaPanel card={card} onRegenerate={onRegenerate} regenerating={regenerating} />}
        </div>
    );
}

/* ---------- 1. header ---------- */

function SessionHeader({ data }: { data: ResultData }) {
    const [showPlan, setShowPlan] = useState(false);
    return (
        <div className="mt-6 rounded-lg p-8" style={{ backgroundColor: "#EFEBDF", border: "1px solid #DAD5C7" }}>
            <div className="flex items-start justify-between gap-6">
                <div>
                    <p className="text-xs font-medium uppercase tracking-[0.2em]" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>
                        Interview scorecard {data.completedAt ? `· ${formatDate(data.completedAt)}` : ""}
                    </p>
                    <h1 className="mt-3 text-4xl" style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 600 }}>
                        {data.candidateName}
                    </h1>
                    <p className="mt-2 text-sm" style={{ color: "#63666F" }}>
                        {data.roleTitle || "Role not set"} · recruiter {data.recruiterName || "—"} · {data.candidateEmail || "no email"}
                    </p>
                </div>
                <div className="text-right shrink-0">
                    <Chip label={data.status || "Pre"} tone="purple" />
                    <div className="mt-2 text-xs" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>
                        {data.difficulty || "medium"} · planned {Math.round((data.plannedDurationSec || 300) / 60)} min
                    </div>
                </div>
            </div>
            <button
                onClick={() => setShowPlan((s) => !s)}
                className="mt-4 text-xs underline"
                style={{ color: "#24427A", fontFamily: "'IBM Plex Mono', monospace" }}
            >
                {showPlan ? "Hide" : "Show"} resume & job description the interview was built from
            </button>
            {showPlan && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <PreBlock title="Resume" text={data.resumeText || "(not provided)"} />
                    <PreBlock title="Job description" text={data.jobDescription || "(not provided)"} />
                </div>
            )}
        </div>
    );
}

function PreBlock({ title, text }: { title: string; text: string }) {
    return (
        <div className="rounded-md p-4" style={{ backgroundColor: "#F6F4EE", border: "1px solid #DAD5C7" }}>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>
                {title}
            </p>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-relaxed" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                {text.slice(0, 3000)}
            </pre>
        </div>
    );
}

/* ---------- 2. verdict ---------- */

function VerdictPanel({ card }: { card: Scorecard }) {
    const v = card.verdict;
    return (
        <div className="mt-8">
            <SectionTitle>Top-level verdict</SectionTitle>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 rounded-lg p-6" style={{ backgroundColor: "#EFEBDF", border: "1px solid #DAD5C7" }}>
                    <p className="text-base leading-relaxed" style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}>
                        {v.summary || "—"}
                    </p>
                    <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <ListBlock title="Strengths" items={v.strengths} color="#2E6F52" />
                        <ListBlock title="Concerns" items={v.concerns} color="#9C3B2E" />
                    </div>
                </div>

                <div className="rounded-lg p-6 flex flex-col items-center justify-center text-center" style={{ backgroundColor: "#EFEBDF", border: `1.5px solid ${suggestionColor(v.suggestion)}` }}>
                    <span className="text-6xl leading-none tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, color: suggestionColor(v.suggestion) }}>
                        {v.overall ?? "—"}
                    </span>
                    <span className="mt-1 text-[10px] uppercase tracking-widest" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>
                        overall / 100
                    </span>
                    <span className="mt-4 rounded-full px-4 py-1.5 text-[11px] uppercase tracking-widest" style={{ backgroundColor: suggestionColor(v.suggestion), color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}>
                        {v.suggestion}
                    </span>
                    {v.needsHumanReview && (
                        <div className="mt-4 rounded-md px-3 py-2 text-left" style={{ backgroundColor: "#FBEEEA", border: "1px solid #E3C4B8" }}>
                            <p className="text-[10px] uppercase tracking-widest" style={{ color: "#9C3B2E", fontFamily: "'IBM Plex Mono', monospace" }}>
                                needs human review
                            </p>
                            {v.reviewReasons.map((r, i) => (
                                <p key={i} className="mt-1 text-xs" style={{ color: "#63666F" }}>· {r}</p>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function suggestionColor(s: string | null | undefined): string {
    if (s === "strong") return "#2E6F52";
    if (s === "positive") return "#5B7A3F";
    if (s === "mixed") return "#8A6D1D";
    if (s === "weak") return "#9C3B2E";
    return "#63666F";
}

/* ---------- 3. competencies ---------- */

function CompetencyPanel({ card }: { card: Scorecard }) {
    return (
        <div className="mt-12">
            <SectionTitle>Competency scores {card.competencyMean !== null && <MeanBadge mean={card.competencyMean} />}</SectionTitle>
            <div className="mt-4 space-y-4">
                {card.competencies.map((c) => (
                    <div key={c.name} className="rounded-lg p-5" style={{ backgroundColor: "#EFEBDF", border: "1px solid #DAD5C7" }}>
                        <div className="flex items-center justify-between gap-4">
                            <p className="font-medium">{c.name}</p>
                            <div className="flex items-center gap-2">
                                {c.judgesAgree === false && <Chip label="graders disagree" tone="red" />}
                                {c.status === "scored" && c.score !== null && (
                                    <span className="text-sm tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#24427A" }}>
                                        {c.score}/5{c.secondScore !== null && ` · 2nd grader: ${c.secondScore}/5`}
                                    </span>
                                )}
                                <Chip label={c.status === "scored" ? "scored" : c.status === "not_assessed" ? "not assessed" : "insufficient evidence"}
                                    tone={c.status === "scored" ? "green" : c.status === "not_assessed" ? "gray" : "amber"} />
                            </div>
                        </div>

                        {c.status !== "not_assessed" && (
                            <>
                                <p className="mt-2 text-sm leading-relaxed" style={{ color: "#1E2128" }}>{c.rationale}</p>
                                {c.quotes.length > 0 && (
                                    <div className="mt-3 space-y-1.5">
                                        {c.quotes.map((q, i) => (
                                            <p key={i} className="text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#63666F" }}>
                                                <span style={{ color: "#24427A" }}>T{q.turn}</span> · “{q.quote}”
                                            </p>
                                        ))}
                                    </div>
                                )}
                                {c.gaps.length > 0 && (
                                    <p className="mt-2 text-xs" style={{ color: "#8A6D1D" }}>
                                        Gaps: {c.gaps.join(" · ")}
                                    </p>
                                )}
                            </>
                        )}
                        {c.status === "not_assessed" && (
                            <p className="mt-2 text-sm" style={{ color: "#9A9789" }}>The interview never probed this competency.</p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function MeanBadge({ mean }: { mean: number }) {
    return (
        <span className="ml-2 text-xs tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#24427A" }}>
            weighted mean {mean}/100
        </span>
    );
}

/* ---------- factors ---------- */

function FactorAnswers({ card }: { card: Scorecard }) {
    const f = card.factors.answers;
    return (
        <Panel title="Factor 1 — Answer quality" right={f.score !== null ? `${f.score}/100` : "not scoreable"}>
            <p className="text-sm" style={{ color: "#63666F" }}>{f.note}</p>
        </Panel>
    );
}

const CLAIM_TONES: Record<string, { bg: string; fg: string }> = {
    confirmed: { bg: "#E7EFE9", fg: "#2E6F52" },
    partly_supported: { bg: "#F3ECD9", fg: "#8A6D1D" },
    not_supported: { bg: "#FBEEEA", fg: "#9C3B2E" },
    not_discussed: { bg: "#ECECE6", fg: "#63666F" },
};

function FactorResume({ card }: { card: Scorecard }) {
    const f = card.factors.resumeMatch;
    return (
        <Panel title="Factor 2 — Resume match" right={f.score !== null ? `${f.score}/100` : "not scoreable"}>
            <p className="text-sm" style={{ color: "#63666F" }}>{f.note}</p>
            {f.claims.length > 0 && (
                <div className="mt-4 space-y-2">
                    {f.claims.map((c, i) => {
                        const tone = CLAIM_TONES[c.verdict] || CLAIM_TONES.not_discussed;
                        return (
                            <div key={i} className="flex items-start gap-3 rounded-md px-4 py-2.5" style={{ backgroundColor: "#F6F4EE", border: "1px solid #E7E2D3" }}>
                                <span className="rounded-full px-2.5 py-0.5 text-[9px] uppercase tracking-widest shrink-0 mt-0.5" style={{ backgroundColor: tone.bg, color: tone.fg, fontFamily: "'IBM Plex Mono', monospace" }}>
                                    {c.verdict.replace("_", " ")}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-sm">{c.claim}</p>
                                    <p className="text-xs" style={{ color: "#63666F" }}>
                                        {c.note}{c.turns.length > 0 && ` · turns ${c.turns.map((t) => `T${t}`).join(", ")}`}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </Panel>
    );
}

const SEV_COLORS: Record<number, string> = { 1: "#8A6D1D", 2: "#B3562E", 3: "#9C3B2E" };

function FactorAuthenticity({ card }: { card: Scorecard }) {
    const f = card.factors.authenticity;
    const measured = f.signals.filter((s) => s.source === "measured");
    const grader = f.signals.filter((s) => s.source === "grader");
    return (
        <Panel title="Factor 3 — Authenticity (higher = more self-consistent)" right={f.score !== null ? `${f.score}/100` : "not scoreable"}>
            <p className="text-xs" style={{ color: "#63666F" }}>
                Signals carry severity 1–3 and are split by source. There is deliberately no single "cheating probability" — it would not be reliable.
            </p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <p className="text-[10px] uppercase tracking-widest" style={{ color: "#24427A", fontFamily: "'IBM Plex Mono', monospace" }}>Measured (event log & timing)</p>
                    <SignalList signals={measured} />
                </div>
                <div>
                    <p className="text-[10px] uppercase tracking-widest" style={{ color: "#5B4A82", fontFamily: "'IBM Plex Mono', monospace" }}>Grader (transcript reading)</p>
                    <SignalList signals={grader} />
                </div>
            </div>
        </Panel>
    );
}

function SignalList({ signals }: { signals: AuthSignal[] }) {
    if (!signals.length) return <p className="mt-2 text-sm" style={{ color: "#9A9789" }}>None observed.</p>;
    return (
        <div className="mt-2 space-y-2">
            {signals.map((s, i) => (
                <div key={i} className="rounded-md px-3 py-2" style={{ backgroundColor: "#F6F4EE", border: "1px solid #E7E2D3" }}>
                    <span className="text-[9px] uppercase tracking-widest rounded-full px-2 py-0.5" style={{ backgroundColor: `${SEV_COLORS[s.severity]}22`, color: SEV_COLORS[s.severity], fontFamily: "'IBM Plex Mono', monospace" }}>
                        severity {s.severity}
                    </span>
                    <p className="mt-1 text-sm">{s.note}{s.turn ? ` (T${s.turn})` : ""}</p>
                </div>
            ))}
        </div>
    );
}

function IntegritySignals({ card }: { card: Scorecard }) {
    const s = card.integritySignals;
    return (
        <div className="mt-12">
            <SectionTitle>Integrity signals — purely measured, from the event log</SectionTitle>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricChip label="Tab hidden" value={`${s.tabHiddenCount}× · ${s.tabHiddenSec}s`} />
                <MetricChip label="Window blur" value={`${s.blurCount}×`} />
                <MetricChip label="Disconnects" value={`${s.disconnects}×`} />
                <MetricChip label="Median latency" value={s.medianResponseLatencySec !== null ? `${s.medianResponseLatencySec}s` : "—"} />
            </div>
            {s.advisories.length > 0 && (
                <div className="mt-4 space-y-1.5">
                    {s.advisories.map((a, i) => (
                        <p key={i} className="text-xs" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>
                            {a.turn ? `T${a.turn}` : "—"} · {a.note}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

const MOMENT_LABELS: Record<string, string> = {
    looking_away: "looking away",
    reading: "reading",
    other_person: "other person",
    second_device: "second device",
    left_frame: "left frame",
    other: "other",
};

function FactorVideo({ card }: { card: Scorecard }) {
    const v = card.factors.video;
    return (
        <Panel
            title="Factor 4 — Video behaviour"
            right={v.status === "analysed" && v.score !== null ? `${v.score}/100` : v.status}
        >
            {v.status !== "analysed" && (
                <p className="text-sm" style={{ color: "#9C3B2E" }}>
                    {v.status === "no_recording" ? "No camera recording was uploaded." : v.reason || v.status}
                </p>
            )}
            {v.status === "analysed" && (
                <>
                    <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>
                        <span>attention {v.attentionPct ?? "—"}%</span>
                        <span>· {v.frameCount} frames analysed</span>
                        {v.model && <span>· model {v.model}</span>}
                    </div>
                    {v.summary && <p className="mt-2 text-sm leading-relaxed" style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}>{v.summary}</p>}

                    {v.moments.length > 0 && (
                        <div className="mt-4">
                            <p className="text-[10px] uppercase tracking-widest" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>Moments to watch</p>
                            <div className="mt-2 space-y-2">
                                {v.moments.map((m, i) => (
                                    <div key={i} className="flex gap-3 rounded-md px-4 py-2.5" style={{ backgroundColor: "#FBEEEA", border: "1px solid #E3C4B8" }}>
                                        <span className="w-24 shrink-0 text-[11px] tabular-nums pt-0.5" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#63666F" }}>
                                            {fmtAt(m.at)} · {m.durationSec}s
                                        </span>
                                        <span className="w-28 shrink-0 text-[10px] uppercase tracking-widest pt-0.5" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#9C3B2E" }}>
                                            {MOMENT_LABELS[m.kind] || m.kind}
                                        </span>
                                        <span className="flex-1 text-sm">{m.description}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                            <p className="text-[10px] uppercase tracking-widest" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>Per-answer gaze</p>
                            <div className="mt-2 space-y-1.5">
                                {v.perAnswer.length === 0 && <p className="text-sm" style={{ color: "#9A9789" }}>No frames aligned with answers.</p>}
                                {v.perAnswer.map((a) => (
                                    <p key={a.turn} className="text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                        <span style={{ color: "#24427A" }}>T{a.turn}</span> {fmtAt(a.at)} · {a.dominantGaze.replace("_", " ")} ({a.framesObserved} frames){a.reading && <span style={{ color: "#9C3B2E" }}> · reading</span>}
                                    </p>
                                ))}
                            </div>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase tracking-widest" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>Gaze pattern (computed)</p>
                            <div className="mt-2 space-y-1.5 text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                <p>answers observed: {v.gazePattern.answersObserved}</p>
                                <p>habitual listening direction: {v.gazePattern.habitualListeningDirection?.replace("_", " ") || "—"}</p>
                                <p>held off-screen direction while answering: {v.gazePattern.heldOffScreenDirection?.replace("_", " ") || "—"}</p>
                                <p>same-spot answers: {v.gazePattern.sameSpotAnswerCount}</p>
                                <p>reading answers: {v.gazePattern.readingAnswerCount}</p>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </Panel>
    );
}

/* ---------- recording ---------- */

function RecordingPanel({ data }: { data: ResultData }) {
    const url = data.recording.hasRecording && data.recording.recordingUrl
        ? `${API}${data.recording.recordingUrl}`
        : null;
    return (
        <div className="mt-12">
            <SectionTitle>Recording (recruiter only)</SectionTitle>
            {url ? (
                <video
                    controls
                    src={url}
                    className="mt-4 w-full rounded-lg"
                    style={{ backgroundColor: "#1E2128", maxHeight: 420 }}
                />
            ) : (
                <p className="mt-3 text-sm" style={{ color: "#9A9789" }}>
                    No recording was captured for this session{data.recording.recordingStartedAt ? "" : " (camera may have been denied)"}.
                </p>
            )}
        </div>
    );
}

/* ---------- transcript ---------- */

function TranscriptPanel({ data }: { data: ResultData }) {
    return (
        <div className="mt-12">
            <SectionTitle>Transcript</SectionTitle>
            <div className="mt-4 space-y-4">
                {data.transcript.map((t) => (
                    <div key={t.seq} className="flex gap-4">
                        <div className="w-24 shrink-0 pt-0.5 text-right">
                            <span className="text-[11px] uppercase tracking-wider" style={{ fontFamily: "'IBM Plex Mono', monospace", color: t.speaker === "Candidate" ? "#24427A" : "#5B4A82" }}>
                                T{t.seq} {t.speaker === "Candidate" ? "Candidate" : "Interviewer"}
                            </span>
                            <p className="text-[10px] tabular-nums" style={{ color: "#9A9789", fontFamily: "'IBM Plex Mono', monospace" }}>
                                {fmtClock(t.at)}{t.latencySec !== null && ` · +${t.latencySec.toFixed(1)}s`}
                            </p>
                        </div>
                        <div className="flex-1 pb-4" style={{ borderBottom: "1px solid #E7E2D3" }}>
                            <p className="text-[14px] leading-relaxed" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{t.text}</p>
                        </div>
                    </div>
                ))}
                {data.transcript.length === 0 && <p className="text-sm" style={{ color: "#9A9789" }}>No transcript was recorded.</p>}
            </div>
        </div>
    );
}

/* ---------- event log ---------- */

const EVENT_LABELS: Record<string, string> = {
    tab_hidden: "tab hidden",
    tab_visible: "tab visible again",
    window_blur: "window lost focus",
    disconnect: "connection dropped",
};

function EventLogPanel({ data }: { data: ResultData }) {
    return (
        <div className="mt-12">
            <SectionTitle>Event log</SectionTitle>
            {data.eventLog.length === 0 ? (
                <p className="mt-3 text-sm" style={{ color: "#9A9789" }}>No events were recorded during this session.</p>
            ) : (
                <div className="mt-4 space-y-1.5">
                    {data.eventLog.map((e, i) => (
                        <p key={i} className="text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#63666F" }}>
                            {fmtClock(e.at)} · <span style={{ color: e.type === "disconnect" || e.type === "tab_hidden" ? "#9C3B2E" : "#63666F" }}>{EVENT_LABELS[e.type] || e.type}</span>
                            {e.durationSec ? ` · ${e.durationSec}s` : ""}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ---------- peers ---------- */

function PeersPanel({ data }: { data: ResultData }) {
    if (data.peers.length === 0) return null;
    return (
        <div className="mt-12">
            <SectionTitle>Peers — same role, side by side</SectionTitle>
            <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                    <thead>
                        <tr>
                            {["Candidate", "Overall", "Answers", "Resume", "Authenticity", "Video", "Decision"].map((h) => (
                                <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-widest" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace", borderBottom: "1px solid #DAD5C7" }}>
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.peers.map((p) => (
                            <tr key={p.id} style={{ borderBottom: "1px solid #E7E2D3" }}>
                                <td className="px-3 py-2.5">{p.candidateName}</td>
                                <td className="px-3 py-2.5 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{p.overall ?? "—"}</td>
                                <td className="px-3 py-2.5 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{p.factors?.answers ?? "—"}</td>
                                <td className="px-3 py-2.5 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{p.factors?.resumeMatch ?? "—"}</td>
                                <td className="px-3 py-2.5 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{p.factors?.authenticity ?? "—"}</td>
                                <td className="px-3 py-2.5 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{p.factors?.video ?? "—"}</td>
                                <td className="px-3 py-2.5 text-xs" style={{ color: "#63666F" }}>{p.humanDecision || "pending"}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ---------- human decision ---------- */

function HumanDecisionPanel({ data, onSaved }: { data: ResultData; onSaved: () => void }) {
    const [decision, setDecision] = useState<string>(data.humanDecision?.decision || "");
    const [note, setNote] = useState<string>(data.humanDecision?.note || "");
    const [saving, setSaving] = useState(false);
    const { interviewId } = useParams();

    const save = async () => {
        if (!decision) return;
        setSaving(true);
        try {
            await axios.put(`${API}/api/v1/interviews/${interviewId}/decision`, { decision, note });
            onSaved();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mt-12 rounded-lg p-6" style={{ backgroundColor: "#EFEBDF", border: "1px solid #DAD5C7" }}>
            <p className="text-xs font-medium uppercase tracking-widest" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>
                Human decision — recorded by a person, never by the scorecard
            </p>
            {data.humanDecision && (
                <p className="mt-2 text-xs" style={{ color: "#2E6F52", fontFamily: "'IBM Plex Mono', monospace" }}>
                    current: {data.humanDecision.decision}{data.humanDecision.note ? ` · "${data.humanDecision.note}"` : ""} · {formatDate(data.humanDecision.decidedAt)}
                </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
                {["proceed", "hold", "reject"].map((d) => (
                    <button
                        key={d}
                        onClick={() => setDecision(d)}
                        className="rounded-full px-5 py-2 text-xs uppercase tracking-widest transition-colors"
                        style={{
                            backgroundColor: decision === d ? "#24427A" : "transparent",
                            color: decision === d ? "#F6F4EE" : "#63666F",
                            border: "1px solid #DAD5C7",
                            fontFamily: "'IBM Plex Mono', monospace",
                        }}
                    >
                        {d}
                    </button>
                ))}
                <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional note…"
                    className="flex-1 min-w-48 rounded-md px-3 py-2 text-sm outline-none"
                    style={inputStyle}
                />
                <button
                    onClick={save}
                    disabled={saving || !decision}
                    className="rounded-full px-5 py-2 text-xs uppercase tracking-widest disabled:opacity-50"
                    style={{ backgroundColor: "#24427A", color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}
                >
                    {saving ? "Saving…" : "Record decision"}
                </button>
            </div>
        </div>
    );
}

/* ---------- meta ---------- */

function MetaPanel({ card, onRegenerate, regenerating }: { card: Scorecard; onRegenerate: () => void; regenerating: boolean }) {
    return (
        <div className="mt-12">
            <SectionTitle>Data quality & provenance</SectionTitle>
            <div className="mt-3 text-xs space-y-1" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>
                <p>graded by {card.model} · {formatDate(card.generatedAt)}</p>
                {card.dataQualityNotes.map((n, i) => (
                    <p key={i} style={{ color: "#8A6D1D" }}>· {n}</p>
                ))}
            </div>
            <button
                onClick={onRegenerate}
                disabled={regenerating}
                className="mt-4 rounded-full px-5 py-2 text-xs uppercase tracking-widest disabled:opacity-50"
                style={{ backgroundColor: "#5B4A82", color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}
            >
                {regenerating ? "Regrading…" : "Regenerate scorecard"}
            </button>
        </div>
    );
}

/* ---------- shared bits ---------- */

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="mt-8 rounded-lg p-6" style={{ backgroundColor: "#EFEBDF", border: "1px solid #DAD5C7" }}>
            <div className="flex items-center justify-between gap-4">
                <p className="text-xs font-medium uppercase tracking-widest" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>
                    {title}
                </p>
                {right && (
                    <span className="text-sm tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#24427A" }}>
                        {right}
                    </span>
                )}
            </div>
            <div className="mt-3">{children}</div>
        </div>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-xs font-medium uppercase tracking-widest" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>
            {children}
        </p>
    );
}

function Chip({ label, tone }: { label: string; tone: "green" | "amber" | "red" | "gray" | "purple" }) {
    const map = {
        green: { bg: "#E7EFE9", fg: "#2E6F52" },
        amber: { bg: "#F3ECD9", fg: "#8A6D1D" },
        red: { bg: "#FBEEEA", fg: "#9C3B2E" },
        gray: { bg: "#ECECE6", fg: "#63666F" },
        purple: { bg: "#E9E9F2", fg: "#5B4A82" },
    } as const;
    const t = map[tone];
    return (
        <span className="rounded-full px-2.5 py-0.5 text-[9px] uppercase tracking-widest" style={{ backgroundColor: t.bg, color: t.fg, fontFamily: "'IBM Plex Mono', monospace" }}>
            {label}
        </span>
    );
}

function ListBlock({ title, items, color }: { title: string; items: string[]; color: string }) {
    return (
        <div>
            <p className="text-[10px] uppercase tracking-widest" style={{ color, fontFamily: "'IBM Plex Mono', monospace" }}>{title}</p>
            <ul className="mt-2 space-y-1.5">
                {items.map((it, i) => (
                    <li key={i} className="text-sm leading-relaxed">— {it}</li>
                ))}
                {items.length === 0 && <li className="text-sm" style={{ color: "#9A9789" }}>—</li>}
            </ul>
        </div>
    );
}

function MetricChip({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg px-4 py-3" style={{ backgroundColor: "#EFEBDF", border: "1px solid #DAD5C7" }}>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}>{label}</p>
            <p className="mt-1 text-lg tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{value}</p>
        </div>
    );
}

const inputStyle = {
    backgroundColor: "#F6F4EE",
    border: "1px solid #DAD5C7",
    color: "#1E2128",
};

function fmtAt(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.max(0, Math.round(sec % 60));
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtClock(iso: string): string {
    try {
        return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
        return iso;
    }
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
        return iso;
    }
}