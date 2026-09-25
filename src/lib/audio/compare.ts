/**
 * Comparison / loss engine.
 *
 * Produces an *experimental* similarity between a reference and a synthesized
 * signal. It is NOT a perceptual model — it is a configurable weighted blend of
 * objective distances. The optimizer minimizes the LOSS (1 - component score);
 * the UI shows both the overall similarity and each component.
 *
 * Loss components:
 *   L = w_waveform  · waveformLoss
 *     + w_stft      · multiResolutionSTFTLoss   (several FFT sizes)
 *     + w_harmonic  · harmonicLoss
 *     + w_spectral  · spectralEnvelopeLoss
 *     + w_envelope  · amplitudeEnvelopeLoss
 *     + w_transient · transientLoss
 *
 * All weights are configurable for experimentation.
 */

import { averageSpectrum, computeSpectrum } from "../dsp/fft";
import { analyzeEnvelope, estimateSpectralEnvelope, spectralFeatures } from "./analysis";

export interface LossWeights {
  waveform: number;
  stft: number;
  harmonic: number;
  spectral: number;
  envelope: number;
  transient: number;
}

export const DEFAULT_WEIGHTS: LossWeights = {
  waveform: 0.1,
  stft: 0.35,
  harmonic: 0.25,
  spectral: 0.12,
  envelope: 0.13,
  transient: 0.05,
};

export interface SimilarityBreakdown {
  overall: number; // 0..1 (1 == identical)
  waveform: number;
  stft: number;
  harmonic: number;
  spectral: number;
  envelope: number;
  transient: number;
  centroid: number;
}

function resampleTo(buf: Float32Array, length: number): Float32Array {
  if (buf.length === length) return buf;
  const out = new Float32Array(length);
  const ratio = buf.length / length;
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, buf.length - 1);
    const frac = pos - i0;
    out[i] = buf[i0] * (1 - frac) + buf[i1] * frac;
  }
  return out;
}

function waveformScore(a: Float32Array, b: Float32Array): number {
  const len = Math.min(4096, a.length, b.length);
  if (len === 0) return 0;
  const ar = resampleTo(a.subarray(0, Math.min(a.length, len * 4)), len);
  const br = resampleTo(b.subarray(0, Math.min(b.length, len * 4)), len);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    dot += ar[i] * br[i];
    na += ar[i] * ar[i];
    nb += br[i] * br[i];
  }
  if (na < 1e-9 || nb < 1e-9) return 0;
  return Math.max(0, dot / Math.sqrt(na * nb));
}

/**
 * Multi-resolution STFT score. Uses several FFT sizes so both fine spectral
 * structure (large FFT) and transient timing (small FFT) matter. Combines a
 * per-frame log-magnitude L1 distance across resolutions.
 */
export function multiResolutionSTFTScore(
  a: Float32Array,
  b: Float32Array,
  sampleRate: number,
): number {
  const sizes = [512, 1024, 2048, 4096];
  let totalDist = 0;
  let count = 0;
  for (const size of sizes) {
    if (a.length < size || b.length < size) continue;
    const hop = size / 2;
    let dist = 0;
    let frames = 0;
    for (let off = 0; off + size <= Math.min(a.length, b.length); off += hop) {
      const sa = computeSpectrum(a, sampleRate, size, off);
      const sb = computeSpectrum(b, sampleRate, size, off);
      const nB = sa.magnitudes.length;
      let frameDist = 0;
      for (let i = 0; i < nB; i++) {
        const la = Math.log(sa.magnitudes[i] + 1e-5);
        const lb = Math.log(sb.magnitudes[i] + 1e-5);
        frameDist += Math.abs(la - lb);
      }
      dist += frameDist / nB;
      frames++;
    }
    if (frames > 0) {
      totalDist += dist / frames;
      count++;
    }
  }
  if (count === 0) return 0;
  const avg = totalDist / count;
  return Math.max(0, Math.min(1, Math.exp(-avg / 2.2)));
}

function harmonicScore(refRel: number[], synthRel: number[]): number {
  const n = Math.min(refRel.length, synthRel.length);
  if (n === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += refRel[i] * synthRel[i];
    na += refRel[i] * refRel[i];
    nb += synthRel[i] * synthRel[i];
  }
  if (na < 1e-9 || nb < 1e-9) return 0;
  return Math.max(0, dot / Math.sqrt(na * nb));
}

function spectralEnvelopeScore(a: Float32Array, b: Float32Array, sampleRate: number): number {
  const ea = estimateSpectralEnvelope(a, sampleRate);
  const eb = estimateSpectralEnvelope(b, sampleRate);
  const n = Math.min(ea.length, eb.length);
  if (n === 0) return 0;
  let dist = 0;
  for (let i = 0; i < n; i++) {
    dist += Math.abs(ea[i].gainDb - eb[i].gainDb);
  }
  const avgDb = dist / n; // dB
  return Math.max(0, Math.min(1, Math.exp(-avgDb / 12)));
}

function envelopeScore(a: Float32Array, b: Float32Array, sampleRate: number): number {
  const ea = analyzeEnvelope(a, sampleRate).curve;
  const eb = analyzeEnvelope(b, sampleRate).curve;
  const n = 96;
  const ra = resampleTo(ea, n);
  const rb = resampleTo(eb, n);
  let dist = 0;
  for (let i = 0; i < n; i++) dist += Math.abs(ra[i] - rb[i]);
  return Math.max(0, 1 - dist / n);
}

/** Transient/onset score: correlation of the first ~50 ms energy shape. */
function transientScore(a: Float32Array, b: Float32Array, sampleRate: number): number {
  const win = Math.min(a.length, b.length, Math.floor(sampleRate * 0.05));
  if (win < 8) return waveformScore(a, b);
  // energy envelope of the onset region
  const N = 32;
  const ea = new Float32Array(N);
  const eb = new Float32Array(N);
  const step = Math.floor(win / N);
  for (let k = 0; k < N; k++) {
    let sa = 0, sb = 0;
    for (let i = 0; i < step; i++) {
      const idx = k * step + i;
      sa += a[idx] * a[idx];
      sb += b[idx] * b[idx];
    }
    ea[k] = Math.sqrt(sa / step);
    eb[k] = Math.sqrt(sb / step);
  }
  // normalize + correlate
  const norm = (x: Float32Array) => {
    let m = 0;
    for (let i = 0; i < x.length; i++) m = Math.max(m, x[i]);
    if (m > 1e-9) for (let i = 0; i < x.length; i++) x[i] /= m;
  };
  norm(ea); norm(eb);
  let dist = 0;
  for (let k = 0; k < N; k++) dist += Math.abs(ea[k] - eb[k]);
  return Math.max(0, 1 - dist / N);
}

function centroidScore(a: Float32Array, b: Float32Array, sampleRate: number): number {
  const fa = spectralFeatures(a, sampleRate);
  const fb = spectralFeatures(b, sampleRate);
  const denom = Math.max(fa.centroid, fb.centroid, 1);
  return Math.max(0, 1 - Math.abs(fa.centroid - fb.centroid) / denom);
}

/** Measure normalized harmonic relatives from an averaged spectrum + f0. */
export function measureHarmonicRelatives(
  samples: Float32Array,
  sampleRate: number,
  f0: number,
  count = 32,
): number[] {
  const spec = averageSpectrum(samples, sampleRate, 4096, 2048);
  const binHz = sampleRate / spec.fftSize;
  const out: number[] = [];
  for (let n = 1; n <= count; n++) {
    const target = n * f0;
    if (target >= sampleRate * 0.45) {
      out.push(0);
      continue;
    }
    const center = Math.round(target / binHz);
    let peak = 0;
    for (let b = center - 2; b <= center + 2; b++) {
      if (b >= 0 && b < spec.magnitudes.length) peak = Math.max(peak, spec.magnitudes[b]);
    }
    out.push(peak);
  }
  const max = Math.max(...out, 1e-9);
  return out.map((v) => v / max);
}

export interface CompareOptions {
  refHarmonics?: number[];
  synthHarmonics?: number[];
  weights?: LossWeights;
}

/**
 * Compute the full similarity breakdown. `overall` is 1 - weighted loss.
 */
export function compareSignals(
  reference: Float32Array,
  synth: Float32Array,
  sampleRate: number,
  opts: CompareOptions = {},
): SimilarityBreakdown {
  const w = opts.weights ?? DEFAULT_WEIGHTS;

  const waveform = waveformScore(reference, synth);
  const stft = multiResolutionSTFTScore(reference, synth, sampleRate);
  const spectral = spectralEnvelopeScore(reference, synth, sampleRate);
  const envelope = envelopeScore(reference, synth, sampleRate);
  const transient = transientScore(reference, synth, sampleRate);
  const centroid = centroidScore(reference, synth, sampleRate);
  const harmonic =
    opts.refHarmonics && opts.synthHarmonics
      ? harmonicScore(opts.refHarmonics, opts.synthHarmonics)
      : stft;

  const totalW =
    w.waveform + w.stft + w.harmonic + w.spectral + w.envelope + w.transient || 1;
  const overall =
    (w.waveform * waveform +
      w.stft * stft +
      w.harmonic * harmonic +
      w.spectral * spectral +
      w.envelope * envelope +
      w.transient * transient) /
    totalW;

  return { overall, waveform, stft, harmonic, spectral, envelope, transient, centroid };
}
