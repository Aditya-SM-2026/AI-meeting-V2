import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

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

interface InterviewRow {
    id: string;
    candidateName: string;
    candidateEmail?: string | null;
    status: "Pre" | "InProgress" | "Done" | null;
    roleTitle?: string | null;
    difficulty?: string | null;
    overall?: number | null;
    suggestion?: string | null;
    humanDecision?: string | null;
    shareToken: string;
    completedAt?: string | null;
}

export const Reports = () => {
    useReportFonts();
    const navigate = useNavigate();
    const [rows, setRows] = useState<InterviewRow[]>([]);
    const [filter, setFilter] = useState<"all" | "taken" | "scheduled">("all");
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [error, setError] = useState("");
    const menuRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const close = (e: MouseEvent) => {
            if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
            setOpenMenuId(null);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    const loadRows = async () => {
        try {
            const res = await axios.get<InterviewRow[]>(
                `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/v1/interviews`
            );
            setRows(res.data);
        } catch {
            setError("Couldn't load the report list.");
        }
    };

    useEffect(() => {
        loadRows();
    }, []);

    const visibleRows = rows.filter((r) =>
        filter === "all" ? true : filter === "taken" ? r.status === "Done" : r.status !== "Done"
    );

    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            /* clipboard unavailable */
        }
    };

    const shareUrlFor = (token: string) => `${window.location.origin}/room/${token}`;

    const statusStyle = (s: InterviewRow["status"]) =>
        s === "Done"
            ? { bg: "#E7EFE9", fg: "#2E6F52" }
            : s === "InProgress"
            ? { bg: "#F3ECD9", fg: "#8A6D1D" }
            : { bg: "#E9E9F2", fg: "#5B4A82" };

    return (
        <div className="min-h-screen w-full" style={{ backgroundColor: "#F6F4EE", color: "#1E2128" }}>
            <div className="mx-auto max-w-5xl px-6 py-10">
                {/* Top bar — back to the form page */}
                <div className="flex items-center justify-between">
                    <button
                        onClick={() => navigate("/")}
                        className="rounded-full px-5 py-2.5 text-xs uppercase tracking-widest transition-colors"
                        style={{
                            backgroundColor: "#E9E9F2",
                            color: "#5B4A82",
                            border: "1px solid #DAD5C7",
                            fontFamily: "'IBM Plex Mono', monospace",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(0.95)")}
                        onMouseLeave={(e) => (e.currentTarget.style.filter = "")}
                    >
                        ← Home
                    </button>
                    <p
                        className="text-xs uppercase tracking-[0.2em]"
                        style={{ color: "#9A9789", fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                        Medhas Academy
                    </p>
                </div>

                <h1
                    className="mt-8 text-4xl"
                    style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 600 }}
                >
                    Interview reports
                </h1>
                <p className="mt-2 text-sm" style={{ color: "#63666F" }}>
                    Every interview and its integrity report. Reports are generated once when the
                    interview completes and open instantly afterwards.
                </p>

                {error && <p className="mt-4 text-sm" style={{ color: "#9C3B2E" }}>{error}</p>}

                {/* Filter tabs */}
                <div className="mt-8 flex gap-2">
                    {([
                        ["all", "All"],
                        ["taken", "Taken"],
                        ["scheduled", "Scheduled"],
                    ] as const).map(([key, label]) => {
                        const count =
                            key === "all"
                                ? rows.length
                                : key === "taken"
                                ? rows.filter((r) => r.status === "Done").length
                                : rows.filter((r) => r.status !== "Done").length;
                        const active = filter === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setFilter(key)}
                                className="rounded-full px-4 py-1.5 text-[10px] uppercase tracking-widest transition-colors"
                                style={{
                                    backgroundColor: active ? "#24427A" : "transparent",
                                    color: active ? "#F6F4EE" : "#63666F",
                                    border: "1px solid #DAD5C7",
                                    fontFamily: "'IBM Plex Mono', monospace",
                                }}
                            >
                                {label} · {count}
                            </button>
                        );
                    })}
                </div>

                {visibleRows.length === 0 ? (
                    <p className="mt-6 text-sm" style={{ color: "#9A9789" }}>
                        {filter === "taken"
                            ? "No reports yet — reports appear here once an interview is completed."
                            : "Nothing here yet."}
                    </p>
                ) : (
                    <div className="mt-6 overflow-x-auto">
                        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                            <thead>
                                <tr>
                                    {["Candidate", "Role", "Status", "Overall", "Suggestion", "Decision", "Completed", ""].map((h) => (
                                        <th
                                            key={h}
                                            className="text-left px-3 py-2 text-[10px] uppercase tracking-widest"
                                            style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace", borderBottom: "1px solid #DAD5C7" }}
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {visibleRows.map((r) => {
                                    const st = statusStyle(r.status);
                                    return (
                                        <tr key={r.id} style={{ borderBottom: "1px solid #E7E2D3" }}>
                                            <td className="px-3 py-3">
                                                <p className="font-medium">{r.candidateName}</p>
                                                {r.candidateEmail && (
                                                    <p className="text-xs" style={{ color: "#63666F" }}>{r.candidateEmail}</p>
                                                )}
                                            </td>
                                            <td className="px-3 py-3" style={{ color: "#63666F" }}>
                                                <p>{r.roleTitle || "—"}</p>
                                                {r.difficulty && (
                                                    <p className="text-xs" style={{ color: "#9A9789" }}>{r.difficulty}</p>
                                                )}
                                            </td>
                                            <td className="px-3 py-3">
                                                <span
                                                    className="rounded-full px-3 py-1 text-[10px] uppercase tracking-widest"
                                                    style={{ backgroundColor: st.bg, color: st.fg, fontFamily: "'IBM Plex Mono', monospace" }}
                                                >
                                                    {r.status || "Pre"}
                                                </span>
                                            </td>
                                            <td className="px-3 py-3 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                                {r.overall === null || r.overall === undefined ? "—" : r.overall}
                                            </td>
                                            <td className="px-3 py-3">
                                                {r.suggestion ? (
                                                    <span
                                                        className="text-xs capitalize"
                                                        style={{
                                                            color: r.suggestion === "strong" ? "#2E6F52" : r.suggestion === "positive" ? "#5B7A3F" : r.suggestion === "mixed" ? "#8A6D1D" : r.suggestion === "weak" ? "#9C3B2E" : "#63666F",
                                                            fontFamily: "'IBM Plex Mono', monospace",
                                                        }}
                                                    >
                                                        {r.suggestion}
                                                    </span>
                                                ) : "—"}
                                            </td>
                                            <td className="px-3 py-3">
                                                {r.humanDecision ? (
                                                    <span
                                                        className="rounded-full px-3 py-1 text-[10px] uppercase tracking-widest"
                                                        style={{
                                                            backgroundColor: r.humanDecision === "proceed" ? "#E7EFE9" : r.humanDecision === "hold" ? "#F3ECD9" : "#FBEEEA",
                                                            color: r.humanDecision === "proceed" ? "#2E6F52" : r.humanDecision === "hold" ? "#8A6D1D" : "#9C3B2E",
                                                            fontFamily: "'IBM Plex Mono', monospace",
                                                        }}
                                                    >
                                                        {r.humanDecision}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs" style={{ color: "#9A9789" }}>pending</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-xs" style={{ color: "#63666F" }}>
                                                {r.completedAt ? formatDate(r.completedAt) : "—"}
                                            </td>
                                            <td className="relative px-3 py-3 text-right whitespace-nowrap" ref={r.id === openMenuId ? menuRef as React.RefObject<HTMLTableCellElement> : undefined}>
                                                <button
                                                    onClick={() => navigate(`/report/${r.id}`)}
                                                    disabled={r.status !== "Done"}
                                                    className="rounded-full px-4 py-1.5 text-[10px] uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                    style={{ backgroundColor: "#24427A", color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}
                                                >
                                                    View report
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setOpenMenuId((m) => (m === r.id ? null : r.id));
                                                    }}
                                                    className="ml-2 rounded-md px-2 py-1 text-base leading-none transition-colors"
                                                    style={{
                                                        color: openMenuId === r.id ? "#24427A" : "#63666F",
                                                        backgroundColor: openMenuId === r.id ? "#E9E9F2" : "transparent",
                                                    }}
                                                    aria-label="Row actions"
                                                >
                                                    ⋯
                                                </button>

                                                {openMenuId === r.id && (
                                                    <div
                                                        className="absolute right-3 top-10 z-20 w-44 rounded-md py-1 text-left shadow-lg"
                                                        style={{ backgroundColor: "#FBF9F2", border: "1px solid #DAD5C7" }}
                                                    >
                                                        {r.status !== "Done" && (
                                                            <button
                                                                onClick={() => {
                                                                    setOpenMenuId(null);
                                                                    copy(shareUrlFor(r.shareToken));
                                                                }}
                                                                className="block w-full px-4 py-2 text-left text-xs hover:opacity-70"
                                                                style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#1E2128" }}
                                                            >
                                                                Copy room link
                                                            </button>
                                                        )}
                                                        <div className="my-1" style={{ borderTop: "1px solid #E7E2D3" }} />
                                                        <button
                                                            onClick={async () => {
                                                                setOpenMenuId(null);
                                                                if (!window.confirm(`Delete the interview report for ${r.candidateName}? This cannot be undone.`)) return;
                                                                setDeletingId(r.id);
                                                                try {
                                                                    await axios.delete(
                                                                        `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/v1/interviews/${r.id}`
                                                                    );
                                                                    await loadRows();
                                                                } catch (err: any) {
                                                                    setError(err?.response?.data?.message || "Failed to delete interview.");
                                                                } finally {
                                                                    setDeletingId(null);
                                                                }
                                                            }}
                                                            disabled={deletingId === r.id}
                                                            className="block w-full px-4 py-2 text-left text-xs hover:opacity-70 disabled:opacity-50"
                                                            style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#9C3B2E" }}
                                                        >
                                                            {deletingId === r.id ? "Deleting…" : "Delete"}
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit",
        });
    } catch {
        return iso;
    }
}