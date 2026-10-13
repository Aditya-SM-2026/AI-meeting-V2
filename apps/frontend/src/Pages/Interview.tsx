import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useMicStream } from "../hooks/useMicStream";
import { useAudioPlayer } from "../hooks/useAudioPlayer";
import { useVideoStream } from "../hooks/useVideoStream";

const INTERVIEW_SECONDS = 5 * 60;

// Injects the report's two type families once per app load.
// Move this into index.html if you'd rather not do it at runtime.
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

type ConnectionStatus = "connecting" | "live" | "ended" | "error";

interface TranscriptLine {
    role: "User" | "Assistance";
    text: string;
}

const STATUS_COPY: Record<ConnectionStatus, { label: string; color: string }> = {
    connecting: { label: "Connecting", color: "#8A6D1D" },
    live: { label: "On air", color: "#2E6F52" },
    ended: { label: "Ended", color: "#63666F" },
    error: { label: "Connection error", color: "#9C3B2E" },
};

export const Interview = ({
    interviewId,
    onFinished,
}: {
    interviewId: string;
    onFinished?: () => void;
}) => {
    useReportFonts();
    const audioRef = useRef<HTMLAudioElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const { playChunk, reset: resetPlayer } = useAudioPlayer();

    const finishedRef = useRef(onFinished);
    useEffect(() => {
        finishedRef.current = onFinished;
    }, [onFinished]);

    const [status, setStatus] = useState<ConnectionStatus>("connecting");
    const [aiSpeaking, setAiSpeaking] = useState(false);
    const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
    const [elapsed, setElapsed] = useState(0);
    const remaining = Math.max(0, INTERVIEW_SECONDS - elapsed);
    const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);

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
    }, [video]);

    const videoUploadedRef = useRef(false);
    const eventsRef = useRef<any[]>([]);
    const hiddenAtRef = useRef<number | null>(null);
    const blurredAtRef = useRef<number | null>(null);
    const recordingStartedAtRef = useRef<string | null>(null);

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

    const uploadVideoAnalysis = useCallback(async () => {
        if (videoUploadedRef.current || !interviewId) return;
        videoUploadedRef.current = true;
        const frames = videoRef.current.getFrames();
        if (frames.length === 0 && eventsRef.current.length === 0) return;
        try {
            await axios.post(
                `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/v1/video-analysis`,
                {
                    interviewId,
                    frames,
                    events: eventsRef.current,
                    recordingStartedAt: recordingStartedAtRef.current || undefined,
                },
                { timeout: 90000 }
            );
        } catch (err) {
            console.error("Video analysis upload failed:", err);
        }
    }, [interviewId]);

    const recordingUploadedRef = useRef(false);
    const uploadRecording = useCallback(async () => {
        if (recordingUploadedRef.current || !interviewId || !recordingStartedAtRef.current) return;
        recordingUploadedRef.current = true;
        try {
            const blob = await videoRef.current.stopRecording();
            if (!blob || blob.size === 0 || blob.size > 60 * 1024 * 1024) return;
            const b64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            await axios.post(
                `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/v1/interviews/${interviewId}/recording`,
                { recordingBase64: b64, recordingStartedAt: recordingStartedAtRef.current },
                { timeout: 120000 }
            );
        } catch (err) {
            console.error("Recording upload failed:", err);
        }
    }, [interviewId]);

    // Elapsed session timer.
    useEffect(() => {
        if (status !== "live") return;
        const id = setInterval(() => setElapsed((s) => s + 1), 1000);
        return () => clearInterval(id);
    }, [status]);

    // Autoscroll transcript feed.
    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [transcript]);

    useEffect(() => {
        if (!interviewId) {
            console.error("Interview ID is missing in the URL parameters.");
            setStatus("error");
            return;
        }

        const ws = new WebSocket(import.meta.env.VITE_WS_URL || "ws://localhost:8080");
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
                    setAiSpeaking(true);
                    if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
                    speakingTimeoutRef.current = setTimeout(() => setAiSpeaking(false), 700);
                    break;

                case "status":
                    if (msg.status === "connected") {
                        setStatus("live");
                        micRef.current
                            .start()
                            .catch((err) => console.error("Error starting microphone", err));
                        videoRef.current
                            .start()
                            .then(() => {
                                recordingStartedAtRef.current = new Date().toISOString();
                                videoRef.current.startRecording();
                            })
                            .catch((err) => console.error("Error starting camera", err));
                    } else if (msg.status === "error") {
                        setStatus("error");
                    } else if (msg.status === "disconnected") {
                        setStatus("ended");
                    }
                    break;

                case "transcript":
                    setTranscript((prev) => [...prev, { role: msg.role, text: msg.text }]);
                    break;

                case "interviewComplete":
                    setStatus("ended");
                    void (async () => {
                        await uploadRecording();
                        videoRef.current.stop();
                        await uploadVideoAnalysis();
                        finishedRef.current?.();
                    })();
                    break;

                case "interrupted":
                    setAiSpeaking(false);
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
            void (async () => {
                await uploadRecording();
                videoRef.current.stop();
                await uploadVideoAnalysis();
            })();
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
            await uploadRecording();
            videoRef.current.stop();
            await uploadVideoAnalysis();
            finishedRef.current?.();
        })();
    };

    const statusMeta = STATUS_COPY[status];

    return (
        <div
            className="min-h-screen w-full flex flex-col"
            style={{ backgroundColor: "#F6F4EE", color: "#1E2128" }}
        >
            <audio ref={audioRef} autoPlay />

            {/* Masthead */}
            <div
                className="flex items-center justify-between px-6 sm:px-10 py-6"
                style={{ borderBottom: "1px solid #DAD5C7" }}
            >
                <div>
                    <p
                        className="text-xs font-medium uppercase tracking-[0.2em]"
                        style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                        Live interview
                    </p>
                    <h1
                        className="mt-1 text-2xl sm:text-3xl"
                        style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 600 }}
                    >
                        Session {interviewId}
                    </h1>
                </div>

                <div className="flex items-center gap-5">
                    <span
                        className="text-sm tabular-nums"
                        style={{
                            fontFamily: "'IBM Plex Mono', monospace",
                            color: status === "live" && remaining <= 60 ? "#9C3B2E" : "#63666F",
                            fontWeight: status === "live" && remaining <= 60 ? 500 : 400,
                        }}
                    >
                        {formatElapsed(remaining)}
                    </span>
                    <div className="flex items-center gap-2">
                        <span
                            className="h-2 w-2 rounded-full"
                            style={{
                                backgroundColor: statusMeta.color,
                                boxShadow: status === "live" ? `0 0 0 4px ${statusMeta.color}22` : "none",
                            }}
                        />
                        <span
                            className="text-xs uppercase tracking-widest"
                            style={{ fontFamily: "'IBM Plex Mono', monospace", color: statusMeta.color }}
                        >
                            {statusMeta.label}
                        </span>
                    </div>
                </div>
            </div>

            {/* Main stage */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-0 min-h-0">
                {/* Speaker panels */}
                <div
                    className="flex flex-col items-center justify-center gap-10 px-8 py-12"
                    style={{ borderRight: "1px solid #DAD5C7" }}
                >
                    <VoicePanel
                        label="You"
                        color="#24427A"
                        active={mic.active ?? status === "live"}
                        variant="pulse"
                    />
                    <VoicePanel
                        label="Interviewer"
                        color="#5B4A82"
                        active={aiSpeaking}
                        variant="bars"
                    />

                    {video.active && (
                        <div className="flex flex-col items-center gap-2">
                            <video
                                ref={previewRef}
                                autoPlay
                                playsInline
                                muted
                                className="rounded-lg"
                                style={{
                                    width: 180,
                                    transform: "scaleX(-1)",
                                    border: "1px solid #DAD5C7",
                                    backgroundColor: "#1E2128",
                                }}
                            />
                            <span
                                className="text-[10px] uppercase tracking-widest"
                                style={{
                                    fontFamily: "'IBM Plex Mono', monospace",
                                    color: "#63666F",
                                }}
                            >
                                Camera — sampled for the video report
                            </span>
                        </div>
                    )}
                </div>

                {/* Live transcript */}
                <div className="flex flex-col min-h-0 px-8 py-8">
                    <p
                        className="text-xs font-medium uppercase tracking-widest shrink-0"
                        style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                        Live transcript
                    </p>

                    <div className="mt-5 flex-1 overflow-y-auto space-y-4 pr-2">
                        {transcript.length === 0 ? (
                            <p
                                className="text-sm"
                                style={{ color: "#9A9789", fontFamily: "'IBM Plex Mono', monospace" }}
                            >
                                Transcript will appear here as the conversation begins.
                            </p>
                        ) : (
                            transcript.map((line, i) => (
                                <div key={i} className="flex gap-3">
                                    <span
                                        className="w-24 shrink-0 text-right text-[11px] uppercase tracking-wider pt-0.5"
                                        style={{
                                            fontFamily: "'IBM Plex Mono', monospace",
                                            color: line.role === "User" ? "#24427A" : "#5B4A82",
                                        }}
                                    >
                                        {line.role === "User" ? "Candidate" : "Interviewer"}
                                    </span>
                                    <p
                                        className="flex-1 text-[14px] leading-relaxed"
                                        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                                    >
                                        {line.text}
                                    </p>
                                </div>
                            ))
                        )}
                        <div ref={transcriptEndRef} />
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="px-6 sm:px-10 py-6" style={{ borderTop: "1px solid #DAD5C7" }}>
                <button
                    onClick={endInterview}
                    disabled={status === "ended"}
                    className="w-full rounded-full py-4 text-sm uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                        backgroundColor: "#9C3B2E",
                        color: "#F6F4EE",
                        fontFamily: "'IBM Plex Mono', monospace",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#82301F")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#9C3B2E")}
                >
                    End interview
                </button>
            </div>
        </div>
    );
};

function VoicePanel({
    label,
    color,
    active,
    variant,
}: {
    label: string;
    color: string;
    active: boolean;
    variant: "pulse" | "bars";
}) {
    return (
        <div className="flex flex-col items-center gap-4">
            <div
                className="relative flex items-center justify-center rounded-full"
                style={{
                    width: 132,
                    height: 132,
                    border: `1.5px solid ${color}`,
                    backgroundColor: active ? `${color}0F` : "transparent",
                    transition: "background-color 0.2s ease",
                }}
            >
                {active && (
                    <span
                        className="absolute inset-0 rounded-full animate-ping"
                        style={{ border: `1.5px solid ${color}`, opacity: 0.4 }}
                    />
                )}
                {variant === "bars" ? (
                    <BarsIcon color={color} active={active} />
                ) : (
                    <span
                        className="rounded-full"
                        style={{
                            width: 14,
                            height: 14,
                            backgroundColor: color,
                            opacity: active ? 1 : 0.35,
                        }}
                    />
                )}
            </div>
            <span
                className="text-xs uppercase tracking-widest"
                style={{ fontFamily: "'IBM Plex Mono', monospace", color }}
            >
                {label}
            </span>
        </div>
    );
}

function BarsIcon({ color, active }: { color: string; active: boolean }) {
    const heights = [10, 20, 14, 24, 10];
    return (
        <div className="flex items-end gap-1" style={{ height: 24 }}>
            {heights.map((h, i) => (
                <span
                    key={i}
                    className={active ? "animate-bounce" : ""}
                    style={{
                        width: 3,
                        height: active ? h : 6,
                        backgroundColor: color,
                        opacity: active ? 1 : 0.35,
                        borderRadius: 2,
                        animationDelay: `${i * 90}ms`,
                        animationDuration: "600ms",
                        transition: "height 0.15s ease",
                    }}
                />
            ))}
        </div>
    );
}

function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}