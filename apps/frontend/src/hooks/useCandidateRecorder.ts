import { useCallback, useRef, useState } from 'react';

const SLICE_MS = 4_000;
const RETRIES = 4;
const RETRY_BASE_MS = 800;

export interface UseCandidateRecorderResult {
  start: (stream: MediaStream | null) => boolean;
  stop: () => Promise<void>;
  failed: boolean;
}

export interface RecorderConfig {
  interviewId: string;
  recordingId: string;
  token: string;
  apiUrl: string;
  onEvent: (event: Record<string, any>) => void;
}

/**
 * Records the candidate's camera+mic with MediaRecorder and uploads 4-second
 * slices to the ingest API through a strict in-order promise queue. Each piece
 * retries 4x with 800ms*n backoff; after a 4xx (non-5xx) it gives up entirely
 * (failed = true). recorder.stop() queues the final piece, then sends
 * &final=1. If MediaRecorder is unsupported the interview is never blocked —
 * start() just returns false.
 */
export function useCandidateRecorder(config: RecorderConfig): UseCandidateRecorderResult {
  const [failed, setFailed] = useState<boolean>(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const bytesSentRef = useRef<number>(0);
  const startedAtRef = useRef<number>(0);
  const gaveUpRef = useRef<boolean>(false);
  const finalizedRef = useRef<boolean>(false);

  const upload = useCallback(async (blob: Blob, offset: number, final: boolean) => {
    if (gaveUpRef.current) return;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * attempt));
      }
      try {
        const elapsed = Math.round(performance.now() - startedAtRef.current);
        const url =
          `${config.apiUrl}/api/v1/recordings/${config.interviewId}/upload` +
          `?offset=${offset}&final=${final ? 1 : 0}&elapsed=${elapsed}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-recording-id': config.recordingId,
            'x-recording-token': config.token,
          },
          body: blob.size > 0 ? blob : undefined,
        });
        if (res.ok) return;
        if (res.status >= 400 && res.status < 500) {
          // Client-side problem (bad token, mismatched offset) — retrying won't help
          gaveUpRef.current = true;
          setFailed(true);
          console.error('Recording upload gave up:', res.status, await res.text().catch(() => ''));
          return;
        }
        lastErr = new Error(`upload ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
    }
    console.error('Recording upload failed after retries:', lastErr);
  }, [config]);

  const enqueue = useCallback((blob: Blob, final: boolean) => {
    const offset = bytesSentRef.current;
    bytesSentRef.current += blob.size;
    queueRef.current = queueRef.current
      .then(() => upload(blob, offset, final))
      .catch(() => {});
  }, [upload]);

  const start = useCallback((stream: MediaStream | null): boolean => {
    if (!stream || typeof MediaRecorder === 'undefined') return false;
    const mime =
      (['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] as const)
        .find((m) => MediaRecorder.isTypeSupported(m)) || '';
    if (!mime) return false;

    try {
      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 350_000,
        audioBitsPerSecond: 48_000,
      });
      recorderRef.current = recorder;
      bytesSentRef.current = 0;
      startedAtRef.current = performance.now();
      gaveUpRef.current = false;
      finalizedRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) enqueue(e.data, false);
      };
      recorder.start(SLICE_MS);

      config.onEvent({
        type: 'recording_started',
        at: new Date().toISOString(),
        detail: JSON.stringify({ recordingId: config.recordingId, mimeType: mime }),
      });
      return true;
    } catch {
      return false;
    }
  }, [config, enqueue]);

  const stop = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive' || finalizedRef.current) return;
    finalizedRef.current = true;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop(); // triggers a final dataavailable → queued as the last piece
    });
    // Empty final POST marks the recording finished server-side.
    await upload(new Blob(), bytesSentRef.current, true);
  }, [upload]);

  return { start, stop, failed };
}