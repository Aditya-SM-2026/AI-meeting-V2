import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
export const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.resolve('.data/recordings');
export const MAX_RECORDING_BYTES = 800 * 1024 * 1024;

export function ffmpegPath(): string | null {
    try {
        const mod = require('ffmpeg-static');
        const p = (mod as any)?.default || mod;
        if (typeof p === 'string' && fs.existsSync(p)) return p;
        return null;
    } catch {
        return null;
    }
}

function roomDir(interviewId: string): string {
    if (!SAFE_ID.test(interviewId)) throw new Error('invalid interview id');
    return path.join(RECORDINGS_DIR, interviewId);
}

function recordingPath(interviewId: string, recordingId: string): string {
    if (!SAFE_ID.test(recordingId)) throw new Error('invalid recording id');
    return path.join(roomDir(interviewId), `${recordingId}.webm`);
}

async function currentFileSize(p: string): Promise<number> {
    try {
        const st = await fsp.stat(p);
        return st.size;
    } catch {
        return 0;
    }
}

export interface AppendResult {
    ok: boolean;
    reason?: 'offset_mismatch' | 'too_large' | 'invalid_id';
    size: number;
    first?: boolean;
}

export async function appendRecordingChunk(
    interviewId: string,
    recordingId: string,
    offset: number,
    bytes: Buffer,
    meta?: Record<string, any>
): Promise<AppendResult> {
    if (!SAFE_ID.test(interviewId) || !SAFE_ID.test(recordingId)) {
        return { ok: false, reason: 'invalid_id', size: 0 };
    }
    const p = recordingPath(interviewId, recordingId);
    await fsp.mkdir(path.dirname(p), { recursive: true });

    const size = await currentFileSize(p);
    if (offset + bytes.length <= size) return { ok: true, size, first: size === 0 }; // retry of an already-written piece
    if (offset !== size) return { ok: false, reason: 'offset_mismatch', size };
    if (size + bytes.length > MAX_RECORDING_BYTES) return { ok: false, reason: 'too_large', size };

    if (meta && size === 0) {
        await writeMeta(interviewId, recordingId, meta);
    }
    await fsp.appendFile(p, bytes);
    return { ok: true, size: size + bytes.length, first: size === 0 };
}

export async function markRecordingFinished(interviewId: string, recordingId: string): Promise<void> {
    const dir = roomDir(interviewId);
    await fsp.mkdir(dir, { recursive: true });
    const done = path.join(dir, `${recordingId}.done`);
    await fsp.writeFile(done, new Date().toISOString(), 'utf8');
}

interface RecordingMeta {
    recordingId: string;
    interviewId: string;
    mimeType?: string;
    anchorStartedAt?: string;
    firstChunkAt?: string;
    firstChunkElapsedMs?: number;
    finishedAt?: string;
    [k: string]: any;
}

async function writeMeta(interviewId: string, recordingId: string, meta: Record<string, any>): Promise<void> {
    const p = path.join(roomDir(interviewId), `${recordingId}.meta.json`);
    const full: RecordingMeta = { recordingId, interviewId, ...meta };
    await fsp.writeFile(p, JSON.stringify(full, null, 1), 'utf8');
}

async function readMeta(interviewId: string, recordingId: string): Promise<RecordingMeta | null> {
    try {
        const p = path.join(roomDir(interviewId), `${recordingId}.meta.json`);
        return JSON.parse(await fsp.readFile(p, 'utf8'));
    } catch {
        return null;
    }
}

export async function listRecordings(interviewId: string): Promise<{ recordingId: string; size: number; finished: boolean; meta: RecordingMeta | null }[]> {
    const dir = roomDir(interviewId);
    let files: string[] = [];
    try {
        files = await fsp.readdir(dir);
    } catch {
        return [];
    }
    const out: { recordingId: string; size: number; finished: boolean; meta: RecordingMeta | null }[] = [];
    for (const f of files) {
        if (!f.endsWith('.webm')) continue;
        const recordingId = f.replace(/\.webm$/, '');
        const size = await currentFileSize(path.join(dir, f));
        const finished = files.includes(`${recordingId}.done`);
        out.push({ recordingId, size, finished, meta: await readMeta(interviewId, recordingId) });
    }
    return out;
}

export function pickRecording(list: { recordingId: string; size: number; finished: boolean; meta: RecordingMeta | null }[]) {
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => b.size - a.size);
    const finishedFirst = sorted.filter((r) => r.finished);
    return finishedFirst[0] || sorted[0];
}

/**
 * The room can close before the last piece lands: poll up to 25s for the
 * .done marker; if the file hasn't grown for 12s, proceed with what arrived.
 */
export async function waitForRecordingFinished(interviewId: string, recordingId: string): Promise<void> {
    const dir = roomDir(interviewId);
    const p = recordingPath(interviewId, recordingId);
    const done = path.join(dir, `${recordingId}.done`);
    const started = Date.now();
    let lastSize = await currentFileSize(p);
    let lastGrowth = Date.now();

    while (Date.now() - started < 25_000) {
        if (fs.existsSync(done)) return;
        await new Promise((r) => setTimeout(r, 1000));
        const size = await currentFileSize(p);
        if (size > lastSize) {
            lastSize = size;
            lastGrowth = Date.now();
        } else if (Date.now() - lastGrowth > 12_000) {
            return; // page closed without a final piece — analyse what arrived
        }
    }
}

export async function makeSeekableCopy(interviewId: string, recordingId: string): Promise<{ playPath: string | null; sourcePath: string }> {
    const src = recordingPath(interviewId, recordingId);
    const playPath = path.join(roomDir(interviewId), `${recordingId}.play.webm`);
    const inFlight = (global as any).__playJobs as Map<string, Promise<string | null>> || new Map();
    (global as any).__playJobs = inFlight;

    if (fs.existsSync(playPath)) return { playPath, sourcePath: src };

    const key = `${interviewId}/${recordingId}`;
    let job = inFlight.get(key);
    if (!job) {
        job = (async () => {
            const ff = ffmpegPath();
            if (!ff) return null;
            await new Promise<void>((resolve) => {
                execFile(ff, ['-y', '-i', src, '-c', 'copy', playPath], { timeout: 120_000 }, (err) => {
                    if (err) {
                        try { fs.unlinkSync(playPath); } catch {}
                        resolve();
                    } else resolve();
                });
            });
            return fs.existsSync(playPath) ? playPath : null;
        })();
        inFlight.set(key, job);
        try {
            await job;
        } finally {
            inFlight.delete(key);
        }
    } else {
        await job;
    }
    return { playPath: fs.existsSync(playPath) ? playPath : null, sourcePath: src };
}

export function readRecordingSlice(p: string, start: number, end: number): fs.ReadStream {
    return fs.createReadStream(p, { start, end });
}

export async function recordingFileForPlayback(interviewId: string, recordingId: string): Promise<string | null> {
    const { playPath, sourcePath } = await makeSeekableCopy(interviewId, recordingId);
    return playPath || (fs.existsSync(sourcePath) ? sourcePath : null);
}