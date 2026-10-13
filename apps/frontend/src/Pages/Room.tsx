import axios from "axios";
import { useEffect, useState } from "react";
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

function JoinCard({ config, onStart }: { config: RoomConfig; onStart: () => void }) {
    return (
        <div
            className="rounded-lg px-10 py-12 max-w-lg w-full"
            style={{ backgroundColor: "#EFEBDF", border: "1px solid #DAD5C7" }}
        >
            <p
                className="text-xs font-medium uppercase tracking-[0.2em]"
                style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
            >
                Medhas Academy — AI interview room
            </p>
            <h1
                className="mt-3 text-3xl leading-tight"
                style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 600 }}
            >
                Hello, {config.candidateName}
            </h1>
            {config.recruiterName && (
                <p className="mt-2 text-sm" style={{ color: "#63666F" }}>
                    Your interview with {config.recruiterName} is ready.
                </p>
            )}

            <ul className="mt-8 space-y-3 text-sm" style={{ color: "#1E2128" }}>
                <li className="flex gap-3">
                    <span style={{ color: "#24427A", fontFamily: "'IBM Plex Mono', monospace" }}>01</span>
                    The interview takes exactly <strong>5 minutes</strong> and ends automatically.
                </li>
                <li className="flex gap-3">
                    <span style={{ color: "#24427A", fontFamily: "'IBM Plex Mono', monospace" }}>02</span>
                    It is voice-based — your <strong>microphone and camera</strong> will be used. Allow access when prompted.
                </li>
                <li className="flex gap-3">
                    <span style={{ color: "#24427A", fontFamily: "'IBM Plex Mono', monospace" }}>03</span>
                    Answer in your own words. The interviewer may ask quick follow-ups at any time.
                </li>
                <li className="flex gap-3">
                    <span style={{ color: "#24427A", fontFamily: "'IBM Plex Mono', monospace" }}>04</span>
                    Your answers and session are reviewed afterwards by the hiring team.
                </li>
            </ul>

            <button
                onClick={onStart}
                className="mt-10 w-full rounded-full py-4 text-sm uppercase tracking-widest transition-colors"
                style={{ backgroundColor: "#24427A", color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1B3260")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#24427A")}
            >
                Start interview
            </button>
        </div>
    );
}