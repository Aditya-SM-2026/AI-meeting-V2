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
    recruiterName?: string | null;
    status: "Pre" | "InProgress" | "Done" | null;
    roleTitle?: string | null;
    difficulty?: string | null;
    overall?: number | null;
    suggestion?: string | null;
    aiProbability?: number | null;
    humanDecision?: string | null;
    shareToken: string;
    startedAt?: string | null;
    completedAt?: string | null;
}

const emptyForm = {
    candidateName: "",
    recruiterName: "",
    candidateEmail: "",
    jobDescription: "",
    resumeBase64: "",
    resumeFileName: "",
};

export const Home = () => {
    useReportFonts();
    const navigate = useNavigate();
    const [form, setForm] = useState({ ...emptyForm });
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState("");
    const [createdLink, setCreatedLink] = useState<{ token: string; name: string } | null>(null);
    const [rows, setRows] = useState<InterviewRow[]>([]);
    const [filter, setFilter] = useState<"all" | "taken" | "scheduled">("all");
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const close = () => setOpenMenuId(null);
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
            /* dashboard loads even if list fails */
        }
    };

    const visibleRows = rows.filter((r) =>
        filter === "all" ? true : filter === "taken" ? r.status === "Done" : r.status !== "Done"
    );

    useEffect(() => {
        loadRows();
    }, []);

    const setField = (k: keyof typeof emptyForm, v: string) =>
        setForm((f) => ({ ...f, [k]: v }));

    const onFile = (file: File | null) => {
        if (!file) {
            setField("resumeBase64", "");
            setField("resumeFileName", "");
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            setCreateError("Resume file is too large (max 8 MB).");
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            setField("resumeBase64", String(reader.result).split(",")[1] || "");
            setField("resumeFileName", file.name);
        };
        reader.readAsDataURL(file);
    };

    const createInterview = async () => {
        setCreateError("");
        if (!form.candidateName.trim() || !form.jobDescription.trim()) {
            setCreateError("Candidate name and job description are required.");
            return;
        }
        setCreating(true);
        try {
            const res = await axios.post(
                `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/v1/interviews`,
                form
            );
            setCreatedLink({ token: res.data.shareToken, name: form.candidateName });
            setForm({ ...emptyForm });
            if (fileInputRef.current) fileInputRef.current.value = "";
            loadRows();
        } catch (err: any) {
            setCreateError(err?.response?.data?.message || err?.message || "Failed to create interview.");
        } finally {
            setCreating(false);
        }
    };

    const shareUrlFor = (token: string) =>
        `${window.location.origin}/room/${token}`;

    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            /* clipboard unavailable */
        }
    };

    const statusStyle = (s: InterviewRow["status"]) =>
        s === "Done"
            ? { bg: "#E7EFE9", fg: "#2E6F52" }
            : s === "InProgress"
            ? { bg: "#F3ECD9", fg: "#8A6D1D" }
            : { bg: "#E9E9F2", fg: "#5B4A82" };

    return (
        <div className="min-h-screen w-full" style={{ backgroundColor: "#F6F4EE", color: "#1E2128" }}>
            <div className="mx-auto max-w-5xl px-6 py-14">
                {/* Masthead */}
                <p
                    className="text-xs font-medium uppercase tracking-[0.2em]"
                    style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
                >
                    Medhas Academy — recruiting console
                </p>
                <h1
                    className="mt-3 text-4xl"
                    style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 600 }}
                >
                    AI Interview Bot
                </h1>
                <p className="mt-2 text-sm" style={{ color: "#63666F" }}>
                    Schedule an interview, share the room link, and review the integrity report afterwards.
                </p>

                {/* New interview form */}
                <div
                    className="mt-10 rounded-lg p-8"
                    style={{ backgroundColor: "#EFEBDF", border: "1px solid #DAD5C7" }}
                >
                    <p
                        className="text-xs font-medium uppercase tracking-widest"
                        style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                        Schedule an interview
                    </p>

                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <Field label="Candidate name *">
                            <input
                                className="w-full rounded-md px-3 py-2 text-sm outline-none"
                                style={inputStyle}
                                value={form.candidateName}
                                onChange={(e) => setField("candidateName", e.target.value)}
                                placeholder="e.g. Priya Sharma"
                            />
                        </Field>
                        <Field label="Recruiter name">
                            <input
                                className="w-full rounded-md px-3 py-2 text-sm outline-none"
                                style={inputStyle}
                                value={form.recruiterName}
                                onChange={(e) => setField("recruiterName", e.target.value)}
                                placeholder="e.g. Rahul Verma"
                            />
                        </Field>
                        <Field label="Candidate email">
                            <input
                                className="w-full rounded-md px-3 py-2 text-sm outline-none"
                                style={inputStyle}
                                value={form.candidateEmail}
                                onChange={(e) => setField("candidateEmail", e.target.value)}
                                placeholder="candidate@email.com"
                            />
                        </Field>
                    </div>

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Resume (PDF / txt)">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.txt,application/pdf,text/plain"
                                onChange={(e) => onFile(e.target.files?.[0] || null)}
                                className="w-full text-sm"
                                style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
                            />
                            {form.resumeFileName && (
                                <p className="mt-1 text-xs" style={{ color: "#2E6F52", fontFamily: "'IBM Plex Mono', monospace" }}>
                                    attached: {form.resumeFileName}
                                </p>
                            )}
                        </Field>
                        <Field label="Job description * (paste as text)">
                            <textarea
                                className="w-full rounded-md px-3 py-2 text-sm outline-none"
                                style={{ ...inputStyle, minHeight: 84 }}
                                value={form.jobDescription}
                                onChange={(e) => setField("jobDescription", e.target.value)}
                                placeholder="Role, responsibilities, must-have skills…"
                            />
                        </Field>
                    </div>

                    {createError && (
                        <p className="mt-3 text-sm" style={{ color: "#9C3B2E" }}>{createError}</p>
                    )}

                    <button
                        onClick={createInterview}
                        disabled={creating}
                        className="mt-6 rounded-full px-8 py-3 text-sm uppercase tracking-widest transition-colors disabled:opacity-50"
                        style={{ backgroundColor: "#24427A", color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1B3260")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#24427A")}
                    >
                        {creating ? "Creating…" : "Create interview"}
                    </button>

                    {createdLink && (
                        <div
                            className="mt-6 rounded-md px-4 py-4 flex items-center justify-between gap-4"
                            style={{ backgroundColor: "#E7EFE9", border: "1px solid #BFD6C6" }}
                        >
                            <div className="min-w-0">
                                <p className="text-xs uppercase tracking-widest" style={{ color: "#2E6F52", fontFamily: "'IBM Plex Mono', monospace" }}>
                                    Share this link with {createdLink.name}
                                </p>
                                <p className="mt-1 truncate text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                    {shareUrlFor(createdLink.token)}
                                </p>
                            </div>
                            <button
                                onClick={() => copy(shareUrlFor(createdLink.token))}
                                className="shrink-0 rounded-full px-4 py-2 text-xs uppercase tracking-widest"
                                style={{ backgroundColor: "#2E6F52", color: "#F6F4EE", fontFamily: "'IBM Plex Mono', monospace" }}
                            >
                                Copy
                            </button>
                        </div>
                    )}
                </div>

                {/* Interviews table */}
                <div className="mt-14">
                    <div className="flex items-center justify-between">
                        <p
                            className="text-xs font-medium uppercase tracking-widest"
                            style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                            All interviews
                        </p>
                        <div className="flex gap-2">
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
                    </div>

                    {visibleRows.length === 0 ? (
                        <p className="mt-4 text-sm" style={{ color: "#9A9789" }}>
                            {filter === "taken"
                                ? "No interviews taken yet."
                                : filter === "scheduled"
                                ? "No scheduled interviews — create one above."
                                : "No interviews yet — schedule the first one above."}
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
                                                <td className="relative px-3 py-3 text-right">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setOpenMenuId((m) => (m === r.id ? null : r.id));
                                                        }}
                                                        className="rounded-md px-2 py-1 text-base leading-none transition-colors"
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
                                                            className="absolute right-3 top-9 z-20 w-44 rounded-md py-1 text-left shadow-lg"
                                                            style={{ backgroundColor: "#FBF9F2", border: "1px solid #DAD5C7" }}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                        >
                                                            <button
                                                                onClick={() => {
                                                                    setOpenMenuId(null);
                                                                    navigate(`/report/${r.id}`);
                                                                }}
                                                                className="block w-full px-4 py-2 text-left text-xs hover:opacity-70"
                                                                style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#1E2128" }}
                                                            >
                                                                View report
                                                            </button>
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
                                                                        setCreateError(err?.response?.data?.message || "Failed to delete interview.");
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
        </div>
    );
};

const inputStyle = {
    backgroundColor: "#F6F4EE",
    border: "1px solid #DAD5C7",
    color: "#1E2128",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span
                className="mb-1 block text-[10px] uppercase tracking-widest"
                style={{ color: "#63666F", fontFamily: "'IBM Plex Mono', monospace" }}
            >
                {label}
            </span>
            {children}
        </label>
    );
}

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