import { useCallback, useEffect, useRef, useState } from 'react';

const FRAME_INTERVAL_MS = 4000;
const MAX_FRAMES = 24;
const FRAME_WIDTH = 384;

export interface VideoFrame {
  data: string;
  at: number;
}

export interface UseVideoStreamResult {
  start: () => Promise<void>;
  stop: () => void;
  getFrames: () => VideoFrame[];
  active: boolean;
  startRecording: () => boolean;
  stopRecording: () => Promise<Blob | null>;
}

/**
 * Samples webcam frames periodically during the interview for post-session
 * video behavior analysis. Frames are small (384px JPEG), capped, and carry
 * a timestamp (seconds since the camera started) so the analyst can reason
 * about gaze and behavior over time. When the cap is hit the buffer is halved
 * and the sampling interval doubles, keeping coverage across the whole
 * session. No frames leave the browser until getFrames() is collected and
 * explicitly uploaded.
 */
export function useVideoStream(previewRef?: React.RefObject<HTMLVideoElement | null>): UseVideoStreamResult {
  const [active, setActive] = useState<boolean>(false);

  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const intervalMsRef = useRef<number>(FRAME_INTERVAL_MS);
  const framesRef = useRef<VideoFrame[]>([]);
  const startedAtRef = useRef<number>(0);

  const restartInterval = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(captureFrame, intervalMsRef.current);
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoElRef.current;
    if (!video || video.readyState < 2) return;

    const canvas = document.createElement('canvas');
    const aspect = video.videoWidth ? video.videoHeight / video.videoWidth : 0.75;
    canvas.width = FRAME_WIDTH;
    canvas.height = Math.round(FRAME_WIDTH * aspect);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
    framesRef.current.push({
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      at: Math.round((Date.now() - startedAtRef.current) / 1000),
    });

    if (framesRef.current.length > MAX_FRAMES) {
      framesRef.current = framesRef.current.filter((_, i) => i % 2 === 0);
      intervalMsRef.current *= 2;
      restartInterval();
    }
  }, [restartInterval]);

  const start = useCallback(async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 480, height: 360, facingMode: 'user' },
    });
    streamRef.current = stream;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => {});
    videoElRef.current = video;

    if (previewRef?.current) {
      previewRef.current.srcObject = stream;
    }

    framesRef.current = [];
    startedAtRef.current = Date.now();
    intervalMsRef.current = FRAME_INTERVAL_MS;
    intervalRef.current = window.setInterval(captureFrame, FRAME_INTERVAL_MS);
    setActive(true);
  }, [captureFrame, previewRef]);

  const stop = useCallback((): void => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    videoElRef.current?.pause();
    videoElRef.current = null;
    setActive(false);
  }, []);

  const getFrames = useCallback((): VideoFrame[] => framesRef.current.slice(), []);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback((): boolean => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') return false;
    try {
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 500_000 });
      recordChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      recorder.start(5000);
      recorderRef.current = recorder;
      return true;
    } catch {
      return false;
    }
  }, []);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(recordChunksRef.current, { type: 'video/webm' });
        recorderRef.current = null;
        recordChunksRef.current = [];
        resolve(blob.size > 0 ? blob : null);
      };
      recorder.stop();
    });
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { start, stop, getFrames, active, startRecording, stopRecording };
}