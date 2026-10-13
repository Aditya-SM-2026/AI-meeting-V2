import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import {
    appendRecordingChunk,
    markRecordingFinished,
    listRecordings,
    recordingFileForPlayback,
    readRecordingSlice,
} from '../lib/recordingStore.js';

const router = Router();

/**
 * Chunked recording ingest.
 * POST /api/v1/recordings/:interviewId/upload?offset=<bytes>&final=<0|1>&elapsed=<ms>
 * Headers: x-recording-id, x-recording-token. Body: raw bytes (octet-stream).
 */
router.post('/:interviewId/upload', async (req: Request, res: Response) => {
    try {
        const { interviewId } = req.params;
        const recordingId = String(req.headers['x-recording-id'] || '');
        const token = String(req.headers['x-recording-token'] || '');
        const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
        const final = String(req.query.final || '0') === '1';
        const elapsedMs = parseInt(String(req.query.elapsed || '0'), 10) || 0;

        const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
        if (!interview) { res.status(404).json({ message: 'Unknown interview' }); return; }
        if (!interview.recordingToken || interview.recordingToken !== token) {
            res.status(401).json({ message: 'Invalid recording token' });
            return;
        }
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

        if (final && bytes.length === 0) {
            await markRecordingFinished(interviewId, recordingId);
            res.status(200).json({ ok: true, final: true });
            return;
        }
        if (bytes.length === 0) {
            res.status(400).json({ message: 'Empty chunk' });
            return;
        }

        const result = await appendRecordingChunk(interviewId, recordingId, offset, bytes, {
            mimeType: String(req.headers['x-recording-mime'] || ''),
            anchorStartedAt: String(req.headers['x-recording-started-at'] || '') || undefined,
            firstChunkAt: new Date().toISOString(),
            firstChunkElapsedMs: elapsedMs,
        });

        if (!result.ok) {
            const status = result.reason === 'offset_mismatch' ? 409 : result.reason === 'too_large' ? 413 : 400;
            res.status(status).json({ ok: false, reason: result.reason, size: result.size });
            return;
        }
        res.status(200).json({ ok: true, size: result.size });
    } catch (err: any) {
        console.error('Recording upload error:', err?.message);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/** Recruiter-only: which recordings exist for an interview. */
router.get('/:interviewId', async (req: Request, res: Response) => {
    try {
        const list = await listRecordings(req.params.interviewId);
        res.status(200).json(list.map((r) => ({
            recordingId: r.recordingId,
            size: r.size,
            finished: r.finished,
            anchorStartedAt: r.meta?.anchorStartedAt || null,
            mimeType: r.meta?.mimeType || null,
        })));
    } catch (err: any) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * Range-capable playback (recruiter-only). Serves the seekable .play.webm copy
 * when available, else the raw file. 206 partial content keeps scrubbing smooth.
 */
router.get('/:interviewId/play/:recordingId', async (req: Request, res: Response) => {
    try {
        const { interviewId, recordingId } = req.params;
        const file = await recordingFileForPlayback(interviewId, recordingId);
        if (!file) { res.status(404).json({ message: 'No recording available' }); return; }

        const stat = await (await import('fs/promises')).stat(file);
        const total = stat.size;
        const range = req.headers.range;
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Content-Type', 'video/webm');

        if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            let start = m && m[1] ? parseInt(m[1], 10) : 0;
            let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
            if (isNaN(start) || start < 0) start = 0;
            if (isNaN(end) || end >= total) end = total - 1;
            if (start > end) {
                res.status(416).setHeader('Content-Range', `bytes */${total}`);
                res.end();
                return;
            }
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
            res.setHeader('Content-Length', String(end - start + 1));
            const stream = readRecordingSlice(file, start, end);
            stream.pipe(res);
            return;
        }

        res.setHeader('Content-Length', String(total));
        res.status(200);
        readRecordingSlice(file, 0, total - 1).pipe(res);
    } catch (err: any) {
        console.error('Playback error:', err?.message);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;