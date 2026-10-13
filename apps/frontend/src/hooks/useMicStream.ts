import { useCallback, useRef, useState } from 'react';

const TARGET_SAMPLE_RATE = 16000;

export interface UseMicStreamResult {
  start: () => Promise<void>;
  stop: () => void;
  active: boolean;
  level: number;
  getStream: () => MediaStream | null;
}

export type ChunkHandler = (chunk: string) => void;

/**
 * Captures microphone audio, downsamples it to 16kHz mono PCM16,
 * and hands base64-encoded chunks to onChunk as they're ready.
 * Also reports a rolling 0-1 "level" for a simple VU meter.
 */
export function useMicStream(onChunk: ChunkHandler): UseMicStreamResult {
  const [level, setLevel] = useState<number>(0);
  const [active, setActive] = useState<boolean>(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const start = useCallback(async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const audioCtx = new AudioContextClass();
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    sourceRef.current = source;

    // ScriptProcessorNode is deprecated but universally supported; swap for
    // an AudioWorklet if you need to drop legacy browser support.
    const bufferSize = 4096;
    const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      const input = event.inputBuffer.getChannelData(0);

      // Compute a quick RMS level for the UI meter
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      setLevel(Math.min(1, Math.sqrt(sum / input.length) * 4));

      const downsampled = downsampleTo16k(input, audioCtx.sampleRate, TARGET_SAMPLE_RATE);
      const pcm16 = floatTo16BitPCM(downsampled);
      const base64 = arrayBufferToBase64(pcm16.buffer);
      onChunk(base64);
    };

    source.connect(processor);
    processor.connect(audioCtx.destination); // required by some browsers to keep the node alive
    setActive(true);
  }, [onChunk]);

  const stop = useCallback((): void => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    setActive(false);
    setLevel(0);
  }, []);

  const getStream = useCallback((): MediaStream | null => streamRef.current, []);

  return { start, stop, active, level, getStream };
}

function downsampleTo16k(buffer: Float32Array, inputRate: number, targetRate: number): Float32Array {
  if (targetRate === inputRate) return buffer;
  const ratio = inputRate / targetRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function floatTo16BitPCM(float32Array: Float32Array): Int16Array {
  const out = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
