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

const emptyForm = {
    candidateName: "",
    recruiterName: "",
    candidateEmail: "",
    jobRole: "",
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
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        if (!form.candidateName.trim() || !form.jobRole.trim() || !form.jobDescription.trim()) {
            setCreateError("Candidate name, job role and job description are required.");
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

    return (
        <div className="min-h-screen w-full" style={{ backgroundColor: "#F6F4EE", color: "#1E2128" }}>
            <div className="mx-auto max-w-5xl px-6 py-14">
                {/* Masthead */}
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
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
                            Schedule an interview and share the room link. Reports live on their own page.
                        </p>
                    </div>
                    <button
                        onClick={() => navigate("/reports")}
                        className="shrink-0 rounded-full px-5 py-2.5 text-xs uppercase tracking-widest transition-colors"
                        style={{
                            backgroundColor: "#24427A",
                            color: "#F6F4EE",
                            fontFamily: "'IBM Plex Mono', monospace",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1B3260")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#24427A")}
                    >
                        View reports
                    </button>
                </div>

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
                        <Field label="Job role *">
                            <input
                                className="w-full rounded-md px-3 py-2 text-sm outline-none"
                                style={inputStyle}
                                value={form.jobRole}
                                onChange={(e) => setField("jobRole", e.target.value)}
                                placeholder="e.g. Backend Engineer — AI Team"
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
                        onMouseEnter={(e) => { if (!creating) e.currentTarget.style.backgroundColor = "#1B3260"; }}
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