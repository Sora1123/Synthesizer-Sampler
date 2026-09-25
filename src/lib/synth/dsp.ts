/**
 * Small, dependency-free DSP helpers used by the synthesis engine.
 * All functions are pure / deterministic given their inputs.
 */

import type { ADSRParams } from "./params";

export const TWO_PI = Math.PI * 2;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/** Convert a frequency to the nearest note name + octave, e.g. 261.6 -> "C4". */
export function freqToNoteName(freq: number): string {
  if (!isFinite(freq) || freq <= 0) return "—";
  const midi = Math.round(freqToMidi(freq));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

/** cents deviation from the nearest equal-tempered note */
export function centsOff(freq: number): number {
  if (!isFinite(freq) || freq <= 0) return 0;
  const midi = freqToMidi(freq);
  return Math.round((midi - Math.round(midi)) * 100);
}

/**
 * Evaluate an ADSR envelope (with a hold stage) at time t seconds.
 * The envelope shape: attack (0->1), decay (1->sustain), hold at sustain,
 * release (sustain->0).
 */
export function evalADSR(env: ADSRParams, t: number): number {
  const { attack, decay, sustain, release, hold } = env;
  if (t < 0) return 0;
  const a = Math.max(0, attack);
  const d = Math.max(0, decay);
  const h = Math.max(0, hold);
  const r = Math.max(0, release);

  if (t < a) {
    return a === 0 ? 1 : t / a;
  }
  if (t < a + d) {
    const x = d === 0 ? 1 : (t - a) / d;
    return 1 + (sustain - 1) * x; // 1 -> sustain
  }
  const releaseStart = a + d + h;
  if (t < releaseStart) {
    return sustain;
  }
  const rt = t - releaseStart;
  if (rt < r) {
    const x = r === 0 ? 1 : rt / r;
    return sustain * (1 - x); // sustain -> 0
  }
  return 0;
}

/** Total duration of an ADSR envelope in seconds. */
export function adsrDuration(env: ADSRParams): number {
  return (
    Math.max(0, env.attack) +
    Math.max(0, env.decay) +
    Math.max(0, env.hold) +
    Math.max(0, env.release)
  );
}

/**
 * A tiny seeded PRNG (mulberry32) so noise generation is deterministic.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a noise buffer of the requested color.
 * Deterministic given the seed.
 */
export function generateNoise(
  length: number,
  color: "white" | "pink" | "brown",
  seed = 12345,
): Float32Array {
  const rng = mulberry32(seed);
  const out = new Float32Array(length);

  if (color === "white") {
    for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1;
    return out;
  }

  if (color === "pink") {
    // Paul Kellet's economical pink noise filter.
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = rng() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      out[i] = pink * 0.11;
    }
    return out;
  }

  // brown / red noise: integrated white noise with leak to avoid drift.
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = rng() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

/**
 * A biquad filter that can be applied offline to a Float32Array.
 * Coefficients follow the RBJ Audio EQ Cookbook.
 */
export type BiquadKind = "lowpass" | "highpass" | "bandpass";

export function biquadCoeffs(
  kind: BiquadKind,
  freq: number,
  q: number,
  sampleRate: number,
): { b0: number; b1: number; b2: number; a1: number; a2: number } {
  const f = clamp(freq, 10, sampleRate * 0.49);
  const w0 = (TWO_PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const Q = Math.max(0.0001, q);
  const alpha = sin / (2 * Q);

  let b0 = 0,
    b1 = 0,
    b2 = 0,
    a0 = 1,
    a1 = 0,
    a2 = 0;

  if (kind === "lowpass") {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (kind === "highpass") {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else {
    // bandpass (constant 0 dB peak gain)
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/**
 * Apply a possibly time-varying lowpass/highpass/bandpass filter to a signal.
 * cutoffAt(i) returns the cutoff in Hz for sample i (allows envelope modulation).
 */
export function applyBiquad(
  input: Float32Array,
  kind: BiquadKind,
  cutoffAt: (i: number) => number,
  q: number,
  sampleRate: number,
): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  // Recompute coefficients periodically for efficiency when cutoff varies.
  const RECALC = 64;
  let c = biquadCoeffs(kind, cutoffAt(0), q, sampleRate);
  for (let i = 0; i < input.length; i++) {
    if (i % RECALC === 0) {
      c = biquadCoeffs(kind, cutoffAt(i), q, sampleRate);
    }
    const x0 = input[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

/** One-pole lowpass, cheap, for noise shaping. */
export function onePoleLowpass(
  input: Float32Array,
  cutoff: number,
  sampleRate: number,
): Float32Array {
  const out = new Float32Array(input.length);
  const dt = 1 / sampleRate;
  const rc = 1 / (TWO_PI * clamp(cutoff, 10, sampleRate * 0.49));
  const alpha = dt / (rc + dt);
  let y = 0;
  for (let i = 0; i < input.length; i++) {
    y = y + alpha * (input[i] - y);
    out[i] = y;
  }
  return out;
}

/** One-pole highpass (input minus a one-pole lowpass). */
export function onePoleHighpass(
  input: Float32Array,
  cutoff: number,
  sampleRate: number,
): Float32Array {
  const lp = onePoleLowpass(input, cutoff, sampleRate);
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] - lp[i];
  return out;
}

/**
 * Find the onset (first audible sample) of a signal.
 *
 * Computes a short-window RMS envelope, finds the peak, sets a threshold
 * relative to that peak, and returns the first sample index where the RMS
 * rises above the threshold. Used to trim leading silence so the reference and
 * the synth (which starts at t=0) are time-aligned — otherwise the waveforms
 * and STFT frames are offset and comparison/reconstruction is meaningless.
 */
export function findOnset(
  buf: Float32Array,
  sampleRate: number,
  thresholdRatio = 0.02,
): number {
  const win = Math.max(1, Math.floor(sampleRate * 0.005)); // 5 ms
  const frames = Math.floor(buf.length / win);
  if (frames < 2) return 0;
  let peak = 0;
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * win;
    for (let i = 0; i < win; i++) {
      const s = buf[start + i];
      sum += s * s;
    }
    const r = Math.sqrt(sum / win);
    rms[f] = r;
    if (r > peak) peak = r;
  }
  if (peak < 1e-6) return 0;
  const thresh = peak * thresholdRatio;
  let onsetFrame = 0;
  for (let f = 0; f < frames; f++) {
    if (rms[f] >= thresh) {
      onsetFrame = f;
      break;
    }
  }
  // Back up a couple of frames so we keep the very start of the attack.
  const backup = 2;
  const idx = Math.max(0, (onsetFrame - backup) * win);
  return idx;
}

/**
 * Trim leading (and optionally trailing) silence from a signal so its first
 * audible sample sits at t=0. Returns the trimmed buffer and the number of
 * samples removed from the front.
 */
export function trimSilence(
  buf: Float32Array,
  sampleRate: number,
  trimTail = true,
): { samples: Float32Array; trimmedFront: number } {
  const onset = findOnset(buf, sampleRate);
  let end = buf.length;
  if (trimTail) {
    const win = Math.max(1, Math.floor(sampleRate * 0.005));
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    const thresh = peak * 0.01;
    for (let i = buf.length - 1; i > onset; i--) {
      if (Math.abs(buf[i]) >= thresh) {
        end = Math.min(buf.length, i + win);
        break;
      }
    }
  }
  if (onset === 0 && end === buf.length) {
    return { samples: buf, trimmedFront: 0 };
  }
  return { samples: buf.slice(onset, end), trimmedFront: onset };
}

/** Peak-normalize a signal to the given peak (in place returns new array). */
export function normalizePeak(buf: Float32Array, peak = 0.99): Float32Array {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > max) max = a;
  }
  if (max < 1e-9) return buf;
  const g = peak / max;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] * g;
  return out;
}
