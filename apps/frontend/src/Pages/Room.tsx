import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Interview } from "./Interview";

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

interface RoomConfig {
    interviewId: string;
    candidateName: string;
    recruiterName?: string | null;
    roleTitle?: string | null;
    plannedDurationSec?: number | null;
    recordingToken?: string | null;
}

type Phase = "loading" | "ready" | "live" | "done" | "error";

export const Room = () => {
    useReportFonts();
    const { token } = useParams();
    const [config, setConfig] = useState<RoomConfig | null>(null);
    const [phase, setPhase] = useState<Phase>("loading");
    const [error, setError] = useState("");

    useEffect(() => {
        if (!token) {
            setPhase("error");
            setError("No interview token in the link.");
            return;
        }
        (async () => {
            try {
                const res = await axios.get<RoomConfig>(
                    `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/v1/interviews/room/${token}`
                );
                setConfig(res.data);
                setPhase("ready");
            } catch (err: any) {
                setPhase("error");
                setError(
                    err?.response?.data?.message || err?.message || "Couldn't load this interview."
                );
            }
        })();
    }, [token]);

    return (
        <div
            className="min-h-screen w-full flex items-center justify-center px-6 py-10"
            style={{ backgroundColor: "#F6F4EE", color: "#1E2128" }}
        >
            {phase === "loading" && <p style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Loading interview…</p>}

            {phase === "error" && (
                <div
                    className="rounded-lg px-6 py-8 max-w-md"
                    style={{ backgroundColor: "#FBEEEA", border: "1px solid #E3C4B8" }}
                >
                    <p
                        className="text-xs font-medium uppercase tracking-widest"
                        style={{ color: "#9C3B2E", fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                        Interview unavailable
                    </p>
                    <p className="mt-2 text-sm" style={{ color: "#63666F" }}>{error}</p>
                </div>
            )}

            {phase === "ready" && config && (
                <JoinCard
                    config={config}
                    onStart={() => setPhase("live")}
                />
            )}

            {phase === "live" && config && (
                <div className="w-full min-h-screen">
                    <Interview
                        interviewId={config.interviewId}
                        recordingToken={config.recordingToken || ""}
                        roleTitle={config.roleTitle || "Interview"}
                        plannedDurationSec={config.plannedDurationSec || 300}
                        candidateName={config.candidateName}
                        onFinished={() => setPhase("done")}
                    />
                </div>
            )}

            {phase === "done" && (
                <div
                    className="rounded-lg px-10 py-12 max-w-lg text-center"
                    style={{ backgroundColor: "#EFEBDF", border: "1px solid #DAD5C7" }}
                >
                    <p
                        className="text-xs font-medium uppercase tracking-[0.2em]"
                        style={{ color: "#2E6F52", fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                        Interview complete
                    </p>
                    <h1
                        className="mt-3 text-3xl"
                        style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 600 }}
                    >
                        Thank you, {config?.candidateName?.split(" ")[0] || "candidate"}!
                    </h1>
                    <p className="mt-4 text-sm leading-relaxed" style={{ color: "#63666F" }}>
                        Your interview has ended and your responses are being reviewed by the
                        Medhas Academy hiring team. You can safely close this tab — no further
                        action is needed.
                    </p>
                </div>
            )}
        </div>
    );
};

const inputStyle: React.CSSProperties = {
    backgroundColor: "#F6F4EE",
    border: "1px solid #DAD5C7",
    color: "#1E2128",
};

function JoinCard({ config, onStart }: { config: RoomConfig; onStart: () => void }) {
    const previewRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [camOn, setCamOn] = useState(false);
    const [camError, setCamError] = useState("");
    const [email, setEmail] = useState("");
    const [consent, setConsent] = useState(false);
    const [starting, setStarting] = useState(false);

    const enableCamera = async () => {
        setCamError("");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 480, height: 360, facingMode: "user" },
            });
            streamRef.current = stream;
            if (previewRef.current) previewRef.current.srcObject = stream;
            setCamOn(true);
        } catch (err: any) {
            setCamError(
                err?.name === "NotAllowedError"
                    ? "Camera permission was denied. You can still join, but the report needs the camera."
                    : "Camera unavailable: " + (err?.message || "unknown error")
            );
        }
    };

    const toggleCamera = () => {
        const stream = streamRef.current;
        if (!stream) return;
        const next = !camOn;
        stream.getVideoTracks().forEach((t) => (t.enabled = next));
        setCamOn(next);
    };

    const canJoin = consent && email.trim().length > 3 && email.includes("@");

    const join = async () => {
        setStarting(true);
        try {
            await axios.put(
                `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/v1/interviews/${config.interviewId}/email`,
                { email: email.trim() },
                { timeout: 15000 }
            );
        } catch {
            /* email is a nice-to-have — join anyway */
        }
        onStart();
    };

    return (
        <div
            className="rounded-lg px-10 py-12 max-w-xl w-full"
            style={{ backgroundColor: "#EFEBDF", border: "1px solid #DAD5C7" }}
        >
            <p
                className="text-xs font-medium uppercase tracking-[0.2em]"
                style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
            >
                Medhas Academy — interview room
            </p>
            <h1
                className="mt-3 text-3xl leading-tight"
                style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 600 }}
            >
                {config.roleTitle || "Interview"}
            </h1>
            <p className="mt-2 text-sm" style={{ color: "#63666F" }}>
                Interviewer: <strong>Intervia AI</strong>
                {config.recruiterName ? ` · arranged by ${config.recruiterName}` : ""}
            </p>

            {/* Email */}
            <div className="mt-8">
                <label
                    className="text-[10px] uppercase tracking-widest"
                    style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
                >
                    Your email
                </label>
                <input
                    type="email"
                    className="mt-1.5 w-full rounded-md px-3 py-2.5 text-sm outline-none"
                    style={inputStyle}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                />
            </div>

            {/* Consent */}
            <label className="mt-4 flex items-start gap-3 cursor-pointer select-none">
                <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                    style={{ accentColor: "#24427A" }}
                />
                <span className="text-xs leading-relaxed" style={{ color: "#63666F" }}>
                    I consent to this interview being <strong>recorded</strong> (audio and camera) and
                    analysed for integrity purposes by the Medhas Academy hiring team.
                </span>
            </label>

            {/* Camera preview */}
            <div className="mt-6">
                <div
                    className="relative mx-auto rounded-lg overflow-hidden flex items-center justify-center"
                    style={{ width: 240, height: 180, backgroundColor: "#1E2128", border: "1px solid #DAD5C7" }}
                >
                    {camOn ? (
                        <video
                            ref={previewRef}
                            autoPlay
                            playsInline
                            muted
                            style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
                        />
                    ) : (
                        <span
                            className="text-[10px] uppercase tracking-widest text-center px-4"
                            style={{ color: "#9A9789", fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                            Camera preview
                        </span>
                    )}
                </div>
                <div className="mt-3 flex items-center justify-center gap-3">
                    {!streamRef.current ? (
                        <button
                            onClick={enableCamera}
                            className="rounded-full px-5 py-2 text-xs uppercase tracking-widest transition-colors"
                            style={{ backgroundColor: "#24427A", color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                            Turn on camera
                        </button>
                    ) : (
                        <button
                            onClick={toggleCamera}
                            className="rounded-full px-5 py-2 text-xs uppercase tracking-widest transition-colors"
                            style={{
                                backgroundColor: camOn ? "#E9E9F2" : "#8A6D1D",
                                color: camOn ? "#5B4A82" : "#F6F4EE",
                                fontFamily: "'IBM Plex Mono', monospace",
                            }}
                        >
                            {camOn ? "Camera on — turn off" : "Camera off — turn on"}
                        </button>
                    )}
                </div>
                {camError && (
                    <p className="mt-2 text-center text-xs" style={{ color: "#9C3B2E" }}>{camError}</p>
                )}
            </div>

            <button
                onClick={join}
                disabled={!canJoin || starting}
                className="mt-8 w-full rounded-full py-4 text-sm uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: "#24427A", color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}
                onMouseEnter={(e) => { if (canJoin && !starting) e.currentTarget.style.backgroundColor = "#1B3260"; }}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#24427A")}
            >
                {starting ? "Joining…" : "Join the interview"}
            </button>

            {/* Hand the negotiated stream to the interview via a module-level slot */}
            {streamRef.current && (
                <CameraHandover stream={streamRef.current} />
            )}

            <ul className="mt-6 space-y-2 text-xs" style={{ color: "#9A9789" }}>
                <li>· The interview takes exactly {Math.round((config.plannedDurationSec || 300) / 60)} minutes and ends automatically.</li>
                <li>· Answer in your own words — you can interrupt the interviewer at any point.</li>
                <li>· This interview is recorded and reviewed by the hiring team.</li>
            </ul>
        </div>
    );
}

/**
 * Streams can't be passed through React state across a full remount
 * reliably by value alone — stash it once; the interview adopts it on mount.
 */
let PENDING_CAMERA_STREAM: MediaStream | null = null;
export function takePendingCameraStream(): MediaStream | null {
    const s = PENDING_CAMERA_STREAM;
    PENDING_CAMERA_STREAM = null;
    return s;
}
function CameraHandover({ stream }: { stream: MediaStream | null }) {
    PENDING_CAMERA_STREAM = stream;
    return null;
}