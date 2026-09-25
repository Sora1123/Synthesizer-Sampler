/**
 * Web Audio playback layer.
 *
 * Wraps a single shared AudioContext and plays mono Float32Array buffers.
 * Keeps Web Audio concerns out of the synthesis engine (which is pure DSP).
 */

import { trimSilence } from "../synth/dsp";

let ctx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

export function getAudioContext(): AudioContext {
  if (typeof window === "undefined") {
    throw new Error("AudioContext is only available in the browser");
  }
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

/** The sample rate the browser's audio context runs at. */
export function contextSampleRate(): number {
  return getAudioContext().sampleRate;
}

/** Stop whatever is currently playing. */
export function stopPlayback(): void {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      /* already stopped */
    }
    currentSource.disconnect();
    currentSource = null;
  }
}

/**
 * Play a mono Float32Array. Returns a promise that resolves when playback
 * ends (or is stopped).
 */
export async function playSamples(
  samples: Float32Array,
  sampleRate: number,
): Promise<void> {
  const context = getAudioContext();
  if (context.state === "suspended") {
    await context.resume();
  }
  stopPlayback();

  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  currentSource = source;

  return new Promise<void>((resolve) => {
    source.onended = () => {
      if (currentSource === source) currentSource = null;
      resolve();
    };
    source.start();
  });
}

/**
 * Decode an uploaded audio file (WAV/MP3/OGG/FLAC where the browser supports
 * it) and return a mono Float32Array resampled to `targetRate` and normalized.
 */
export async function decodeAudioFile(
  file: File,
  targetRate = 44100,
): Promise<{
  samples: Float32Array;
  sampleRate: number;
  originalSampleRate: number;
  duration: number;
  channels: number;
  trimmedLeadingSeconds: number;
}> {
  const arrayBuffer = await file.arrayBuffer();
  const context = getAudioContext();
  const decoded = await context.decodeAudioData(arrayBuffer.slice(0));

  const originalSampleRate = decoded.sampleRate;
  const channels = decoded.numberOfChannels;

  // Downmix to mono.
  const len = decoded.length;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < channels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += data[i] / channels;
  }

  // Resample to targetRate via linear interpolation if needed.
  let resampled = mono;
  let outRate = originalSampleRate;
  if (originalSampleRate !== targetRate) {
    const ratio = targetRate / originalSampleRate;
    const outLen = Math.floor(len * ratio);
    resampled = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcPos = i / ratio;
      const i0 = Math.floor(srcPos);
      const i1 = Math.min(i0 + 1, len - 1);
      const frac = srcPos - i0;
      resampled[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
    }
    outRate = targetRate;
  }

  // Peak-normalize.
  let max = 0;
  for (let i = 0; i < resampled.length; i++) {
    const a = Math.abs(resampled[i]);
    if (a > max) max = a;
  }
  if (max > 1e-6) {
    const g = 0.99 / max;
    for (let i = 0; i < resampled.length; i++) resampled[i] *= g;
  }

  // Trim leading (and trailing) silence so the first audible sample sits at
  // t=0. The synth always starts at t=0, so without this the reference and
  // synthesized waveforms/STFT frames would be misaligned and comparison would
  // be meaningless (you would get a "totally different waveform").
  const { samples: trimmed, trimmedFront } = trimSilence(resampled, outRate);

  return {
    samples: trimmed,
    sampleRate: outRate,
    originalSampleRate,
    duration: trimmed.length / outRate,
    channels,
    trimmedLeadingSeconds: trimmedFront / outRate,
  };
}

/**
 * Encode a mono Float32Array (samples in -1..1) into a 16-bit PCM WAV file.
 * Returns a Blob suitable for download.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = bytesPerSample; // mono
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  // RIFF header
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  // fmt chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  // data chunk
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // PCM samples (clamped, converted to signed 16-bit)
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/** Trigger a browser download of a mono Float32Array as a .wav file. */
export function downloadWav(
  samples: Float32Array,
  sampleRate: number,
  fileName = "synthesis.wav",
): void {
  if (typeof window === "undefined") return;
  const blob = encodeWav(samples, sampleRate);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".wav") ? fileName : `${fileName}.wav`;
  a.click();
  URL.revokeObjectURL(url);
}
