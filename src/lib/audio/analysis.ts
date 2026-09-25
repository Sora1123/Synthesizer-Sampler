/**
 * Reference-audio analysis engine (high-resolution).
 *
 * Pure functions (no React, no Web Audio) so they can run in a Web Worker or
 * inside the optimisation loop. Beyond static features, this now tracks the
 * TIME-VARYING amplitude of each partial across the note (STFT frame tracking),
 * measures per-partial frequencies (for inharmonicity), estimates a spectral
 * envelope, spectral flux, and a broadband noise level. These feed the
 * high-dimensional predictor so the synth can reproduce evolving timbre.
 */

import { averageSpectrum, computeSpectrum } from "../dsp/fft";

export interface HarmonicMeasurement {
  n: number;
  freq: number;
  magnitude: number;
  relative: number;
  /** measured frequency ratio to the fundamental (freq / (n*f0)) */
  ratio: number;
  /**
   * Time-varying amplitude trajectory across the note (normalized 0..1 in both
   * time and amplitude). Length == number of STFT frames tracked.
   */
  trajectory: number[];
}

export interface EnvelopeAnalysis {
  curve: Float32Array;
  hopSeconds: number;
  attack: number;
  decay: number;
  sustainLevel: number;
  release: number;
}

export interface SpectralEnvelopePoint {
  freq: number;
  gainDb: number;
}

export interface AudioAnalysis {
  sampleRate: number;
  duration: number;
  fundamental: number;
  pitchConfidence: number;
  harmonics: HarmonicMeasurement[];
  /** number of STFT frames used for trajectories */
  frameCount: number;
  /** seconds per trajectory frame */
  frameHopSeconds: number;
  spectralCentroid: number;
  spectralBandwidth: number;
  spectralRolloff: number;
  zeroCrossingRate: number;
  inharmonicity: number;
  /** coarse spectral envelope as (freq, gainDb) points */
  spectralEnvelope: SpectralEnvelopePoint[];
  /** spectral flux over time (normalized 0..1) — how fast the spectrum changes */
  spectralFlux: number[];
  /** average spectral flux (0..1): higher = more evolving/noisy */
  meanFlux: number;
  /** estimated broadband noise level relative to tonal energy (0..1) */
  noisiness: number;
  envelope: EnvelopeAnalysis;
  rms: number;
}

// --- YIN pitch detection (unchanged core) ---------------------------------

export function detectPitchYIN(
  samples: Float32Array,
  sampleRate: number,
  fmin = 50,
  fmax = 2000,
  threshold = 0.15,
): { freq: number; confidence: number } {
  const windowSize = Math.min(2048, samples.length);
  const start = Math.max(0, Math.floor(samples.length * 0.25) - windowSize / 2);
  const buf = samples.subarray(start, start + windowSize);
  const n = buf.length;

  const tauMax = Math.min(Math.floor(sampleRate / fmin), Math.floor(n / 2));
  const tauMin = Math.max(2, Math.floor(sampleRate / fmax));

  const diff = new Float32Array(tauMax);
  for (let tau = tauMin; tau < tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < n - tauMax; i++) {
      const d = buf[i] - buf[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    running += diff[tau];
    cmnd[tau] = running === 0 ? 1 : (diff[tau] * tau) / running;
  }

  let tauEstimate = -1;
  for (let tau = tauMin; tau < tauMax - 1; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate === -1) {
    let minVal = Infinity;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (cmnd[tau] < minVal) {
        minVal = cmnd[tau];
        tauEstimate = tau;
      }
    }
  }
  if (tauEstimate <= 0) return { freq: 0, confidence: 0 };

  const x0 = tauEstimate > 0 ? tauEstimate - 1 : tauEstimate;
  const x2 = tauEstimate + 1 < tauMax ? tauEstimate + 1 : tauEstimate;
  let betterTau = tauEstimate;
  if (x0 !== tauEstimate && x2 !== tauEstimate) {
    const s0 = cmnd[x0];
    const s1 = cmnd[tauEstimate];
    const s2 = cmnd[x2];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tauEstimate + (s2 - s0) / denom;
  }

  const freq = sampleRate / betterTau;
  const confidence = Math.max(0, Math.min(1, 1 - cmnd[tauEstimate]));
  return { freq, confidence };
}

// --- Time-varying harmonic tracking ---------------------------------------

/**
 * Track each partial's amplitude over time via a sequence of STFT frames.
 * For each frame and each harmonic n, find the local peak near n*f0.
 */
export function trackHarmonics(
  samples: Float32Array,
  sampleRate: number,
  f0: number,
  maxHarmonics: number,
  targetFrames = 24,
): {
  harmonics: HarmonicMeasurement[];
  inharmonicity: number;
  frameCount: number;
  frameHopSeconds: number;
  spectralFlux: number[];
  meanFlux: number;
} {
  const fftSize = 4096;
  const usable = Math.max(0, samples.length - fftSize);
  const hop = Math.max(fftSize / 4, Math.floor(usable / Math.max(1, targetFrames)) || fftSize / 2);
  const binHz = sampleRate / fftSize;

  // Collect frames.
  const frameOffsets: number[] = [];
  for (let off = 0; off + fftSize <= samples.length; off += hop) {
    frameOffsets.push(off);
  }
  if (frameOffsets.length === 0) frameOffsets.push(0);
  const frameCount = frameOffsets.length;

  const maxH = Math.min(maxHarmonics, Math.floor((sampleRate * 0.45) / f0));
  // Per-harmonic trajectory (magnitude per frame) + accumulated freq/ratio.
  const traj: number[][] = Array.from({ length: maxH }, () => []);
  const freqSum = new Float64Array(maxH);
  const freqWeight = new Float64Array(maxH);

  // Spectral flux accumulation (frame-to-frame magnitude increase).
  const flux: number[] = [];
  let prevMags: Float32Array | null = null;

  for (let fi = 0; fi < frameCount; fi++) {
    const spec = computeSpectrum(samples, sampleRate, fftSize, frameOffsets[fi]);
    // flux
    if (prevMags) {
      let f = 0;
      const nB = Math.min(prevMags.length, spec.magnitudes.length);
      for (let b = 0; b < nB; b++) {
        const d = spec.magnitudes[b] - prevMags[b];
        if (d > 0) f += d;
      }
      flux.push(f);
    } else {
      flux.push(0);
    }
    prevMags = spec.magnitudes;

    for (let h = 0; h < maxH; h++) {
      const n = h + 1;
      const target = n * f0;
      // Search window grows with n so strongly-inharmonic (stretched) upper
      // partials are still found (piano/bell). Bounded to under half the
      // partial spacing so we don't grab a neighbouring partial.
      const searchHz = Math.min(f0 * 0.45, Math.max(binHz * 2, f0 * 0.02 * n));
      const lo = Math.max(0, Math.floor((target - searchHz) / binHz));
      const hi = Math.min(spec.magnitudes.length - 1, Math.ceil((target + searchHz) / binHz));
      let peakBin = lo;
      let peakMag = -Infinity;
      for (let b = lo; b <= hi; b++) {
        if (spec.magnitudes[b] > peakMag) {
          peakMag = spec.magnitudes[b];
          peakBin = b;
        }
      }
      let freq = peakBin * binHz;
      if (peakBin > 0 && peakBin < spec.magnitudes.length - 1) {
        const a = spec.magnitudes[peakBin - 1];
        const b = spec.magnitudes[peakBin];
        const c = spec.magnitudes[peakBin + 1];
        const denom = a - 2 * b + c;
        if (denom !== 0) freq = (peakBin + 0.5 * (a - c) / denom) * binHz;
      }
      traj[h].push(Math.max(0, peakMag));
      freqSum[h] += freq * peakMag;
      freqWeight[h] += peakMag;
    }
  }

  // Normalize flux to 0..1.
  const maxFlux = Math.max(...flux, 1e-9);
  const normFlux = flux.map((f) => f / maxFlux);
  const meanFlux = normFlux.reduce((a, b) => a + b, 0) / Math.max(1, normFlux.length);

  // Build measurements: peak magnitude across time + normalized trajectory.
  const measurements: HarmonicMeasurement[] = [];
  let globalMax = 1e-9;
  for (let h = 0; h < maxH; h++) {
    const peak = Math.max(...traj[h], 0);
    if (peak > globalMax) globalMax = peak;
  }
  for (let h = 0; h < maxH; h++) {
    const n = h + 1;
    const peak = Math.max(...traj[h], 0);
    const freq = freqWeight[h] > 0 ? freqSum[h] / freqWeight[h] : n * f0;
    // per-partial normalized trajectory (relative to its own peak)
    const localPeak = Math.max(peak, 1e-9);
    const trajectory = traj[h].map((m) => m / localPeak);
    measurements.push({
      n,
      freq,
      magnitude: peak,
      relative: peak / globalMax,
      ratio: freq / (n * f0),
      trajectory,
    });
  }

  // Inharmonicity B from partial drift, magnitude-weighted least squares.
  let num = 0;
  let den = 0;
  for (const m of measurements) {
    if (m.n < 2) continue;
    const ratio = m.freq / (m.n * f0);
    const y = ratio * ratio - 1;
    const x = m.n * m.n;
    const w = m.relative;
    num += w * x * y;
    den += w * x * x;
  }
  let B = den > 0 ? num / den : 0;
  if (!isFinite(B) || B < 0) B = 0;
  B = Math.min(B, 0.01);

  return {
    harmonics: measurements,
    inharmonicity: B,
    frameCount,
    frameHopSeconds: hop / sampleRate,
    spectralFlux: normFlux,
    meanFlux,
  };
}

// --- Spectral envelope + features -----------------------------------------

/** Estimate a coarse spectral envelope as (freq, gainDb) points (log-spaced). */
export function estimateSpectralEnvelope(
  samples: Float32Array,
  sampleRate: number,
): SpectralEnvelopePoint[] {
  const spec = averageSpectrum(samples, sampleRate, 4096, 2048);
  const bandEdges = [20, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, sampleRate / 2];
  const points: SpectralEnvelopePoint[] = [];
  let maxDb = -Infinity;
  const raw: { freq: number; db: number }[] = [];
  for (let bi = 0; bi < bandEdges.length - 1; bi++) {
    const lo = bandEdges[bi];
    const hi = bandEdges[bi + 1];
    let sum = 0;
    let count = 0;
    for (let i = 0; i < spec.magnitudes.length; i++) {
      const f = spec.freqs[i];
      if (f >= lo && f < hi) {
        sum += spec.magnitudes[i];
        count++;
      }
    }
    const avg = count > 0 ? sum / count : 0;
    const db = 20 * Math.log10(avg + 1e-9);
    const centerFreq = Math.sqrt(lo * hi);
    raw.push({ freq: centerFreq, db });
    if (db > maxDb) maxDb = db;
  }
  for (const r of raw) points.push({ freq: r.freq, gainDb: r.db - maxDb });
  return points;
}

export function spectralFeatures(samples: Float32Array, sampleRate: number) {
  const spec = averageSpectrum(samples, sampleRate, 4096, 2048);
  let sumMag = 0;
  let sumFreqMag = 0;
  let totalEnergy = 0;
  for (let i = 0; i < spec.magnitudes.length; i++) {
    const m = spec.magnitudes[i];
    sumMag += m;
    sumFreqMag += m * spec.freqs[i];
    totalEnergy += m * m;
  }
  const centroid = sumMag > 0 ? sumFreqMag / sumMag : 0;
  let variance = 0;
  for (let i = 0; i < spec.magnitudes.length; i++) {
    const d = spec.freqs[i] - centroid;
    variance += spec.magnitudes[i] * d * d;
  }
  const bandwidth = sumMag > 0 ? Math.sqrt(variance / sumMag) : 0;
  let cumulative = 0;
  const target = totalEnergy * 0.85;
  let rolloff = 0;
  for (let i = 0; i < spec.magnitudes.length; i++) {
    cumulative += spec.magnitudes[i] * spec.magnitudes[i];
    if (cumulative >= target) {
      rolloff = spec.freqs[i];
      break;
    }
  }
  return { centroid, bandwidth, rolloff };
}

/**
 * Estimate broadband noisiness: ratio of energy NOT captured by harmonic peaks
 * to total energy. High for breathy/bowed/percussive sounds.
 */
export function estimateNoisiness(
  samples: Float32Array,
  sampleRate: number,
  f0: number,
): number {
  const spec = averageSpectrum(samples, sampleRate, 4096, 2048);
  const binHz = sampleRate / spec.fftSize;
  let total = 0;
  let harmonic = 0;
  const halfWin = Math.max(1, Math.round((f0 * 0.03) / binHz));
  const harmonicBins = new Set<number>();
  for (let n = 1; n * f0 < sampleRate * 0.45; n++) {
    const center = Math.round((n * f0) / binHz);
    for (let b = center - halfWin; b <= center + halfWin; b++) {
      if (b >= 0 && b < spec.magnitudes.length) harmonicBins.add(b);
    }
  }
  for (let i = 0; i < spec.magnitudes.length; i++) {
    const e = spec.magnitudes[i] * spec.magnitudes[i];
    total += e;
    if (harmonicBins.has(i)) harmonic += e;
  }
  if (total < 1e-12) return 0;
  return Math.max(0, Math.min(1, 1 - harmonic / total));
}

export function zeroCrossingRate(samples: Float32Array, sampleRate: number): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] < 0 && samples[i] >= 0) || (samples[i - 1] >= 0 && samples[i] < 0)) {
      crossings++;
    }
  }
  return (crossings * sampleRate) / samples.length;
}

export function analyzeEnvelope(
  samples: Float32Array,
  sampleRate: number,
): EnvelopeAnalysis {
  const frame = Math.max(1, Math.floor(sampleRate * 0.005));
  const hop = frame;
  const numFrames = Math.floor(samples.length / hop);
  const curve = new Float32Array(numFrames);
  let maxRms = 0;
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < frame && start + i < samples.length; i++) {
      const s = samples[start + i];
      sum += s * s;
    }
    const rms = Math.sqrt(sum / frame);
    curve[f] = rms;
    if (rms > maxRms) maxRms = rms;
  }
  if (maxRms > 1e-9) for (let f = 0; f < numFrames; f++) curve[f] /= maxRms;

  const hopSeconds = hop / sampleRate;
  let peakIdx = 0;
  let peakVal = 0;
  for (let f = 0; f < numFrames; f++) {
    if (curve[f] > peakVal) {
      peakVal = curve[f];
      peakIdx = f;
    }
  }
  let attackIdx = 0;
  for (let f = 0; f <= peakIdx; f++) {
    if (curve[f] >= 0.9) {
      attackIdx = f;
      break;
    }
  }
  const attack = attackIdx * hopSeconds;
  const midStart = Math.floor(numFrames * 0.4);
  const midEnd = Math.floor(numFrames * 0.7);
  const midVals: number[] = [];
  for (let f = midStart; f < midEnd; f++) midVals.push(curve[f]);
  midVals.sort((a, b) => a - b);
  const sustainLevel = midVals.length > 0 ? midVals[Math.floor(midVals.length / 2)] : 0;
  let decayIdx = peakIdx;
  for (let f = peakIdx; f < numFrames; f++) {
    if (curve[f] <= sustainLevel * 1.05) {
      decayIdx = f;
      break;
    }
  }
  const decay = Math.max(0, (decayIdx - peakIdx) * hopSeconds);
  let releaseStart = numFrames - 1;
  const relThresh = Math.max(sustainLevel * 0.9, 0.05);
  for (let f = numFrames - 1; f >= 0; f--) {
    if (curve[f] >= relThresh) {
      releaseStart = f;
      break;
    }
  }
  const release = Math.max(0, (numFrames - 1 - releaseStart) * hopSeconds);
  return { curve, hopSeconds, attack, decay, sustainLevel, release };
}

export function overallRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/**
 * Full analysis pipeline. Single entry point used by the UI and Auto Match.
 */
export function analyzeAudio(
  samples: Float32Array,
  sampleRate: number,
  maxHarmonics = 64,
): AudioAnalysis {
  const { freq, confidence } = detectPitchYIN(samples, sampleRate);
  const f0 = freq > 0 ? freq : 261.63;
  const tracked = trackHarmonics(samples, sampleRate, f0, maxHarmonics);
  const { centroid, bandwidth, rolloff } = spectralFeatures(samples, sampleRate);
  const zcr = zeroCrossingRate(samples, sampleRate);
  const envelope = analyzeEnvelope(samples, sampleRate);
  const rms = overallRms(samples);
  const spectralEnvelope = estimateSpectralEnvelope(samples, sampleRate);
  const noisiness = estimateNoisiness(samples, sampleRate, f0);

  return {
    sampleRate,
    duration: samples.length / sampleRate,
    fundamental: f0,
    pitchConfidence: confidence,
    harmonics: tracked.harmonics,
    frameCount: tracked.frameCount,
    frameHopSeconds: tracked.frameHopSeconds,
    spectralCentroid: centroid,
    spectralBandwidth: bandwidth,
    spectralRolloff: rolloff,
    zeroCrossingRate: zcr,
    inharmonicity: tracked.inharmonicity,
    spectralEnvelope,
    spectralFlux: tracked.spectralFlux,
    meanFlux: tracked.meanFlux,
    noisiness,
    envelope,
    rms,
  };
}
