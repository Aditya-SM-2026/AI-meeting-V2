import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useMicStream } from "../hooks/useMicStream";
import { useAudioPlayer } from "../hooks/useAudioPlayer";
import { useVideoStream } from "../hooks/useVideoStream";
import { useCandidateRecorder } from "../hooks/useCandidateRecorder";
import { takePendingCameraStream } from "./Room";

interface TranscriptLine {
    role: "User" | "Assistance";
    text: string;
}

const STATUS_COPY = {
    connecting: { label: "Connecting…", color: "#8A6D1D", bg: "#F3ECD9" },
    live: { label: "Connected", color: "#2E6F52", bg: "#E7EFE9" },
    reconnecting: { label: "Reconnecting…", color: "#8A6D1D", bg: "#F3ECD9" },
    ended: { label: "Ended", color: "#63666F", bg: "#E9E9F2" },
    error: { label: "Connection error", color: "#9C3B2E", bg: "#FBEEEA" },
} as const;

type PillKey = keyof typeof STATUS_COPY;

export const Interview = ({
    interviewId,
    recordingToken,
    roleTitle,
    plannedDurationSec,
    candidateName,
    onFinished,
}: {
    interviewId: string;
    recordingToken: string;
    roleTitle: string;
    plannedDurationSec: number;
    candidateName: string;
    onFinished?: () => void;
}) => {
    const wsRef = useRef<WebSocket | null>(null);
    const { playChunk, reset: resetPlayer, audioState, resumeAudio } = useAudioPlayer();

    const finishedRef = useRef(onFinished);
    useEffect(() => {
        finishedRef.current = onFinished;
    }, [onFinished]);

    const [status, setStatus] = useState<"connecting" | "live" | "ended" | "error">("connecting");
    const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
    const [elapsed, setElapsed] = useState(0);
    const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);

    // Room controls
    const [micOn, setMicOn] = useState(true);
    const [camOn, setCamOn] = useState(true);
    const [showConversation, setShowConversation] = useState(true);
    const [soundBlocked, setSoundBlocked] = useState(false);
    const [lastQuestion, setLastQuestion] = useState("");

    // Voice state: speaking > thinking (just answered) > listening
    const [voiceState, setVoiceState] = useState<"listening" | "speaking" | "thinking">("listening");

    const handleMicChunk = useCallback((base64: string) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            const audioMessage = {
                type: "audioMessage",
                payload: {
                    realtimeInput: {
                        audio: {
                            data: base64,
                            mimeType: "audio/pcm;rate=16000",
                        },
                    },
                },
            };
            ws.send(JSON.stringify(audioMessage));
        }
    }, []);

    const mic = useMicStream(handleMicChunk);
    const micRef = useRef(mic);
    useEffect(() => {
        micRef.current = mic;
    }, [mic]);

    const previewRef = useRef<HTMLVideoElement>(null);
    const video = useVideoStream(previewRef);
    const videoRef = useRef(video);
    useEffect(() => {
        videoRef.current = video;
        // Adopt the stream negotiated on the join screen (camera toggle there
        // already decided the initial on/off state).
        if (videoRef.current && !videoRef.current.getStream()) {
            const pending = takePendingCameraStream();
            if (pending) {
                videoRef.current.adopt(pending);
                const enabled = pending.getVideoTracks().every((t) => t.enabled);
                setCamOn(enabled);
            }
        }
    }, [video]);

    const eventsRef = useRef<any[]>([]);
    const hiddenAtRef = useRef<number | null>(null);
    const blurredAtRef = useRef<number | null>(null);
    const recordingIdRef = useRef<string>(
        typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    );
    const pushEvent = useCallback((event: Record<string, any>) => {
        eventsRef.current.push(event);
    }, []);

    const recorder = useCandidateRecorder({
        interviewId,
        recordingId: recordingIdRef.current,
        token: recordingToken,
        apiUrl: import.meta.env.VITE_API_URL || "http://localhost:3001",
        onEvent: pushEvent,
    });
    const recorderRef = useRef(recorder);
    useEffect(() => {
        recorderRef.current = recorder;
    }, [recorder]);

    const telemetrySentRef = useRef(false);
    const sendTelemetry = useCallback(async () => {
        if (telemetrySentRef.current || !interviewId) return;
        telemetrySentRef.current = true;
        if (eventsRef.current.length === 0) return;
        try {
            await axios.post(
                `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/v1/telemetry`,
                { interviewId, events: eventsRef.current },
                { timeout: 30000 }
            );
        } catch (err) {
            console.error("Telemetry upload failed:", err);
        }
    }, [interviewId]);

    const finalizeSession = useCallback(async () => {
        // Order matters: the recorder's final piece must reach the server
        // before the page can be closed. Telemetry rides along after.
        await recorderRef.current.stop().catch(() => {});
        videoRef.current.stop();
        await sendTelemetry().catch(() => {});
    }, [sendTelemetry]);

    // Consent + join markers.
    useEffect(() => {
        eventsRef.current.push({ type: "consent_granted", at: new Date().toISOString() });
        eventsRef.current.push({ type: "joined", at: new Date().toISOString() });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Tab/window visibility — feeds the integrity report.
    useEffect(() => {
        const onVisibility = () => {
            if (document.hidden) {
                hiddenAtRef.current = Date.now();
                eventsRef.current.push({ type: "tab_hidden", at: new Date().toISOString() });
            } else if (hiddenAtRef.current !== null) {
                eventsRef.current.push({
                    type: "tab_visible",
                    at: new Date().toISOString(),
                    durationSec: Math.round((Date.now() - hiddenAtRef.current) / 1000),
                });
                hiddenAtRef.current = null;
            }
        };
        const onBlur = () => {
            blurredAtRef.current = Date.now();
            eventsRef.current.push({ type: "window_blur", at: new Date().toISOString() });
        };
        const onFocus = () => {
            if (blurredAtRef.current !== null) {
                blurredAtRef.current = null;
            }
        };
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("blur", onBlur);
        window.addEventListener("focus", onFocus);
        return () => {
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    // Elapsed session timer.
    useEffect(() => {
        if (status !== "live") return;
        const id = setInterval(() => setElapsed((s) => s + 1), 1000);
        return () => clearInterval(id);
    }, [status]);

    // Autoscroll transcript feed (inner container only — never the page).
    useEffect(() => {
        const end = transcriptEndRef.current;
        const box = end?.closest(".transcript-scroll") as HTMLElement | null;
        if (end && box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    }, [transcript, showConversation]);

    useEffect(() => {
        if (!interviewId) {
            console.error("Interview ID is missing in the URL parameters.");
            setStatus("error");
            return;
        }

        const ws = new WebSocket(import.meta.env.VITE_WS_URL || "ws://localhost:8081");
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({ type: "init", payload: { interviewId } }));
        };

        ws.onmessage = (event) => {
            let msg: any;
            try {
                msg = JSON.parse(event.data);
            } catch (err) {
                console.error("Received non-JSON WebSocket message:", event.data);
                return;
            }

            switch (msg.type) {
                case "audio":
                    playChunk(msg.payload.data);
                    setVoiceState("speaking");
                    if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
                    speakingTimeoutRef.current = setTimeout(() => {
                        setVoiceState((s) => (s === "speaking" ? "listening" : s));
                    }, 700);
                    if (audioState() === "suspended") setSoundBlocked(true);
                    break;

                case "status":
                    if (msg.status === "connected") {
                        setStatus("live");
                        micRef.current
                            .start()
                            .then(() => {
                                const vStream = videoRef.current.getStream();
                                const aStream = micRef.current.getStream();
                                if (!vStream || !aStream) return;
                                const combined = new MediaStream([
                                    ...vStream.getVideoTracks(),
                                    ...aStream.getAudioTracks(),
                                ]);
                                const ok = recorderRef.current.start(combined);
                                if (!ok) console.warn("Recording unsupported in this browser");
                            })
                            .catch((err) => console.error("Error starting microphone", err));
                    } else if (msg.status === "error") {
                        setStatus("error");
                    } else if (msg.status === "disconnected") {
                        setStatus("ended");
                    }
                    break;

                case "transcript":
                    setTranscript((prev) => {
                        const line: TranscriptLine = { role: msg.role, text: msg.text };
                        const next = [...prev, line];
                        if (line.role === "Assistance") setLastQuestion(line.text);
                        if (line.role === "User") setVoiceState("thinking");
                        return next;
                    });
                    break;

                case "interviewComplete":
                    setStatus("ended");
                    setVoiceState("listening");
                    void (async () => {
                        await finalizeSession();
                        finishedRef.current?.();
                    })();
                    break;

                case "interrupted":
                    setVoiceState((s) => (s === "speaking" ? "listening" : s));
                    break;

                default:
                    break;
            }
        };

        ws.onerror = (error) => {
            console.error("WebSocket Error:", error);
            setStatus("error");
        };

        ws.onclose = (event) => {
            console.log("WebSocket Closed", event.code, event.reason);
            eventsRef.current.push({ type: "disconnect", at: new Date().toISOString() });
            micRef.current.stop();
            void finalizeSession();
            wsRef.current = null;
            setStatus((s) => (s === "ended" ? s : "ended"));
        };

        return () => {
            micRef.current.stop();
            videoRef.current.stop();
            resetPlayer();
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        };
    }, [interviewId]);

    const endInterview = () => {
        void (async () => {
            micRef.current.stop();
            resetPlayer();
            wsRef.current?.close();
            await finalizeSession();
            finishedRef.current?.();
        })();
    };

    const leaveInterview = () => {
        if (window.confirm("Leave the interview? Everything answered so far is saved and the interview will end.")) {
            endInterview();
        }
    };

    const toggleMic = () => {
        const stream = micRef.current.getStream();
        if (!stream) return;
        const next = !micOn;
        stream.getAudioTracks().forEach((t) => (t.enabled = next));
        setMicOn(next);
        eventsRef.current.push({ type: next ? "mic_unmuted" : "mic_muted", at: new Date().toISOString() });
    };

    const toggleCam = () => {
        const stream = videoRef.current.getStream();
        if (!stream) return;
        const next = !camOn;
        stream.getVideoTracks().forEach((t) => (t.enabled = next));
        setCamOn(next);
        eventsRef.current.push({ type: next ? "camera_on" : "camera_off", at: new Date().toISOString() });
    };

    const enableSound = async () => {
        await resumeAudio();
        setSoundBlocked(false);
    };

    // Progress + timer
    const totalSec = plannedDurationSec || 300;
    const pct = Math.min(100, (elapsed / totalSec) * 100);
    const remaining = Math.max(0, totalSec - elapsed);

    const pillKey: PillKey =
        status === "live"
            ? "live"
            : status === "connecting"
                ? "connecting"
                : status === "error"
                    ? "error"
                    : "ended";
    const pill = STATUS_COPY[pillKey];

    const VOICE_COPY = {
        listening: "Listening to you",
        speaking: "Interviewer is speaking",
        thinking: "Thinking…",
    } as const;
    const voiceColor =
        voiceState === "speaking" ? "#5B4A82" : voiceState === "thinking" ? "#8A6D1D" : "#24427A";

    return (
        <div className="h-screen w-full flex flex-col overflow-hidden" style={{ backgroundColor: "#F6F4EE", color: "#1E2128" }}>
            {/* 1. Thin progress bar — time used */}
            <div className="w-full" style={{ height: 4, backgroundColor: "#E7E2D3" }}>
                <div
                    className="h-full transition-all duration-1000"
                    style={{
                        width: `${pct}%`,
                        backgroundColor: remaining <= 60 ? "#9C3B2E" : "#24427A",
                    }}
                />
            </div>

            {/* 2. Header bar */}
            <div
                className="flex items-center justify-between px-5 sm:px-8 py-3.5 shrink-0"
                style={{ borderBottom: "1px solid #DAD5C7" }}
            >
                <div className="flex items-baseline gap-3 min-w-0">
                    <span
                        className="text-xl shrink-0"
                        style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 600 }}
                    >
                        Intervia
                    </span>
                    <span style={{ color: "#C9C4B4" }}>·</span>
                    <span
                        className="text-sm truncate"
                        style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                        {roleTitle}
                    </span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                    <span
                        className="text-sm tabular-nums hidden sm:inline"
                        style={{
                            fontFamily: "'IBM Plex Mono', monospace",
                            color: remaining <= 60 ? "#9C3B2E" : "#63666F",
                            fontWeight: remaining <= 60 ? 500 : 400,
                        }}
                    >
                        {formatElapsed(elapsed)} of {Math.round(totalSec / 60)} min
                    </span>
                    <span
                        className="rounded-full px-3 py-1 text-[10px] uppercase tracking-widest"
                        style={{
                            backgroundColor: pill.bg,
                            color: pill.color,
                            fontFamily: "'IBM Plex Mono', monospace",
                        }}
                    >
                        {pill.label}
                    </span>
                </div>
            </div>

            {/* Main area: center stage + conversation sidebar */}
            <div className="flex-1 min-h-0 flex flex-col md:flex-row">
                {/* 3. Center stage */}
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-8 relative">
                    {/* Voice state */}
                    <VoiceOrb color={voiceColor} active={voiceState !== "listening"} />
                    <p
                        className="mt-4 text-xs uppercase tracking-[0.2em]"
                        style={{ color: voiceColor, fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                        {VOICE_COPY[voiceState]}
                    </p>

                    {/* Large question line */}
                    <div className="mt-8 max-w-2xl text-center min-h-[96px] flex items-center justify-center">
                        {lastQuestion ? (
                            <p
                                className="text-xl sm:text-2xl leading-snug"
                                style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 400 }}
                            >
                                “{lastQuestion}”
                            </p>
                        ) : (
                            <p className="text-lg" style={{ color: "#9A9789", fontFamily: "'Source Serif 4', Georgia, serif", fontStyle: "italic" }}>
                                The interviewer's question will appear here.
                            </p>
                        )}
                    </div>

                    {/* Conditional sound-enable */}
                    {soundBlocked && status === "live" && (
                        <button
                            onClick={enableSound}
                            className="mt-6 rounded-full px-6 py-3 text-xs uppercase tracking-widest transition-colors"
                            style={{ backgroundColor: "#8A6D1D", color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                            Turn on sound to hear the interviewer
                        </button>
                    )}
                </div>

                {/* 4. Conversation sidebar (desktop right / mobile bottom panel) */}
                {showConversation && (
                    <div
                        className="order-2 md:order-none md:w-[340px] shrink-0 flex flex-col min-h-0"
                        style={{ borderLeft: "1px solid #DAD5C7", borderTop: "1px solid #DAD5C7", maxHeight: "40vh" }}
                    >
                        <p
                            className="px-5 pt-4 pb-3 text-[10px] uppercase tracking-widest shrink-0"
                            style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                            Conversation so far
                        </p>
                        <div className="flex-1 overflow-y-auto transcript-scroll px-5 pb-4 space-y-3">
                            {transcript.length === 0 && (
                                <p className="text-xs" style={{ color: "#9A9789", fontFamily: "'IBM Plex Mono', monospace" }}>
                                    Transcript will appear here as the conversation begins.
                                </p>
                            )}
                            {transcript.map((line, i) => (
                                <div key={i}>
                                    <span
                                        className="text-[10px] uppercase tracking-wider"
                                        style={{
                                            fontFamily: "'IBM Plex Mono', monospace",
                                            color: line.role === "User" ? "#24427A" : "#5B4A82",
                                        }}
                                    >
                                        {line.role === "User" ? candidateName || "You" : "Intervia"}
                                    </span>
                                    <p
                                        className="text-[13px] leading-relaxed mt-0.5"
                                        style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#1E2128" }}
                                    >
                                        {line.text}
                                    </p>
                                </div>
                            ))}
                            <div ref={transcriptEndRef} />
                        </div>
                    </div>
                )}
            </div>

            {/* 5. Footer */}
            <div
                className="shrink-0 px-5 sm:px-8 py-4 flex flex-col sm:flex-row sm:items-center gap-4"
                style={{ borderTop: "1px solid #DAD5C7" }}
            >
                {/* Left: self view */}
                <div className="flex items-center gap-3 shrink-0">
                    <div
                        className="relative rounded-md overflow-hidden"
                        style={{ width: 96, height: 72, backgroundColor: "#1E2128", border: "1px solid #DAD5C7" }}
                    >
                        <video
                            ref={previewRef}
                            autoPlay
                            playsInline
                            muted
                            style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                transform: "scaleX(-1)",
                                opacity: camOn ? 1 : 0.25,
                            }}
                        />
                        {!camOn && (
                            <span
                                className="absolute inset-0 flex items-center justify-center text-[9px] uppercase tracking-widest"
                                style={{ color: "#9A9789", fontFamily: "'IBM Plex Mono', monospace" }}
                            >
                                camera off
                            </span>
                        )}
                    </div>
                    <span
                        className="rounded-full px-3 py-1 text-[10px] uppercase tracking-widest"
                        style={{
                            backgroundColor: "#E9E9F2",
                            color: "#5B4A82",
                            fontFamily: "'IBM Plex Mono', monospace",
                        }}
                    >
                        {candidateName || "You"}
                    </span>
                </div>

                {/* Center-left note */}
                <p
                    className="flex-1 text-xs leading-relaxed hidden md:block"
                    style={{ color: "#9A9789", fontFamily: "'IBM Plex Mono', monospace" }}
                >
                    Take your time to think. You can interrupt at any point.
                    <br />
                    This interview is recorded.
                </p>

                {/* Right controls */}
                <div className="flex items-center justify-end gap-2 flex-wrap shrink-0">
                    <PillButton
                        onClick={() => setShowConversation((v) => !v)}
                        label={showConversation ? "Hide conversation" : "Show conversation"}
                        active={false}
                    />
                    <PillButton
                        onClick={toggleMic}
                        label={micOn ? "Mute" : "Unmute"}
                        danger={!micOn}
                    />
                    <PillButton
                        onClick={toggleCam}
                        label={camOn ? "Camera off" : "Camera on"}
                        danger={!camOn}
                    />
                    <button
                        onClick={leaveInterview}
                        className="rounded-full px-5 py-2.5 text-xs uppercase tracking-widest transition-colors"
                        style={{ backgroundColor: "#9C3B2E", color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#82301F")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#9C3B2E")}
                    >
                        Leave interview
                    </button>
                </div>
            </div>
        </div>
    );
};

function VoiceOrb({ color, active }: { color: string; active: boolean }) {
    const heights = [14, 30, 20, 38, 16, 28, 12];
    return (
        <div
            className="relative flex items-center justify-center rounded-full"
            style={{
                width: 168,
                height: 168,
                border: `1.5px solid ${color}`,
                backgroundColor: active ? `${color}0F` : "transparent",
                transition: "background-color 0.25s ease",
            }}
        >
            {active && (
                <span
                    className="absolute inset-0 rounded-full animate-ping"
                    style={{ border: `1.5px solid ${color}`, opacity: 0.35 }}
                />
            )}
            <div className="flex items-end gap-1.5" style={{ height: 44 }}>
                {heights.map((h, i) => (
                    <span
                        key={i}
                        className={active ? "animate-bounce" : ""}
                        style={{
                            width: 4,
                            height: active ? h : 8,
                            backgroundColor: color,
                            opacity: active ? 1 : 0.3,
                            borderRadius: 2,
                            animationDelay: `${i * 100}ms`,
                            animationDuration: "700ms",
                            transition: "height 0.2s ease",
                        }}
                    />
                ))}
            </div>
        </div>
    );
}

function PillButton({
    onClick,
    label,
    danger,
    active,
}: {
    onClick: () => void;
    label: string;
    danger?: boolean;
    active?: boolean;
}) {
    const bg = danger ? "#FBEEEA" : "#E9E9F2";
    const fg = danger ? "#9C3B2E" : "#5B4A82";
    return (
        <button
            onClick={onClick}
            className="rounded-full px-4 py-2.5 text-xs uppercase tracking-widest transition-colors"
            style={{
                backgroundColor: active ? "#24427A" : bg,
                color: active ? "#F6F4EE" : fg,
                fontFamily: "'IBM Plex Mono', monospace",
                border: "1px solid #DAD5C7",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(0.95)")}
            onMouseLeave={(e) => (e.currentTarget.style.filter = "")}
        >
            {label}
        </button>
    );
}

function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}