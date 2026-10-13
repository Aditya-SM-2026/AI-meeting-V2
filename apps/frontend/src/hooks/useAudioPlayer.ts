import { useCallback, useRef } from 'react';

const PLAYBACK_SAMPLE_RATE = 24000;

/**
 * Queues and plays base64-encoded PCM16 audio chunks (as sent by the
 * Gemini Live API) back-to-back with no gaps.
 */
export function useAudioPlayer() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);

  const ensureCtx = () => {
    if (!audioCtxRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioContextClass({
        sampleRate: PLAYBACK_SAMPLE_RATE,
      });
      nextPlayTimeRef.current = 0;
    }
    return audioCtxRef.current;
  };

  const playChunk = useCallback((base64Data: string) => {
    const ctx = ensureCtx();
    const arrayBuffer = base64ToArrayBuffer(base64Data);
    const int16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buffer = ctx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startTime = Math.max(now, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;
  }, []);

  const reset = useCallback(() => {
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    nextPlayTimeRef.current = 0;
  }, []);

  /** 'suspended' means the browser blocked audio until a user gesture. */
  const audioState = useCallback((): string => audioCtxRef.current?.state ?? 'none', []);

  const resumeAudio = useCallback(async () => {
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
  }, []);

  return { playChunk, reset, audioState, resumeAudio };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
