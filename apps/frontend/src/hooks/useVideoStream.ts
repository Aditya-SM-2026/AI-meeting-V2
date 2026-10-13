import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseVideoStreamResult {
  start: () => Promise<void>;
  stop: () => void;
  adopt: (stream: MediaStream | null) => void;
  active: boolean;
  getStream: () => MediaStream | null;
}

/**
 * Owns the candidate's camera stream: shown as a small mirrored preview and
 * handed to the candidate recorder. No frame sampling happens here — the
 * recording pipeline analyses the stored video after the session.
 */
export function useVideoStream(previewRef?: React.RefObject<HTMLVideoElement | null>): UseVideoStreamResult {
  const [active, setActive] = useState<boolean>(false);

  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 480, height: 360, facingMode: 'user' },
    });
    streamRef.current = stream;

    if (previewRef?.current) {
      previewRef.current.srcObject = stream;
    }
    setActive(true);
  }, [previewRef]);

  const stop = useCallback((): void => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  /** Take over a stream the join screen already negotiated (no re-prompt). */
  const adopt = useCallback((stream: MediaStream | null): void => {
    if (streamRef.current && streamRef.current !== stream) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = stream;
    if (previewRef?.current && stream) {
      previewRef.current.srcObject = stream;
    }
    setActive(Boolean(stream));
  }, [previewRef]);

  const getStream = useCallback((): MediaStream | null => streamRef.current, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { start, stop, adopt, active, getStream };
}