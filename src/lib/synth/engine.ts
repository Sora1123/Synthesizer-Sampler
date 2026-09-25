/**
 * High-dimensional synthesis engine.
 *
 * Renders a SynthParameters patch into a mono Float32Array. Fully deterministic
 * (seeded noise). Contains NO React and NO Web Audio nodes so it runs in the
 * main thread, a Web Worker, or the optimisation loop.
 *
 * The tonal core is a TIME-VARYING additive partial bank:
 *
 *     x(t) = Σ_n  A_n(t) · g_spec(f_n) · sin( 2π · f_n(t) · t + φ_n )
 *
 *   A_n(t)      per-partial amplitude envelope (breakpoints)
 *   f_n(t)      f0·ratio_n·stretch(n)·freqEnv_n(t) + offset_n, plus global pitch env
 *   g_spec(f)   spectral-envelope (formant/resonance) gain at that frequency
 *
 * Layers (oscillators, sub, partial bank, noise, transient) are mixed with
 * independent gains, then the master amplitude envelope + filter are applied.
 */

import {
  applyBiquad,
  type BiquadKind,
  clamp,
  generateNoise,
  onePoleHighpass,
  onePoleLowpass,
  TWO_PI,
} from "./dsp";
import {
  evalBreakpoints,
  type OscillatorParams,
  type SpectralEnvelope,
  type SubOscParams,
  type SynthParameters,
} from "./params";

export function noteDuration(params: SynthParameters): number {
  return Math.max(0.1, params.duration);
}

/** Basic band-unlimited waveforms (partial bank is the spectrally-precise path). */
function basicWave(
  kind: OscillatorParams["waveform"],
  phase: number,
  pulseWidth: number,
): number {
  const p = ((phase % TWO_PI) + TWO_PI) % TWO_PI;
  switch (kind) {
    case "sine":
      return Math.sin(p);
    case "triangle": {
      const x = p / TWO_PI;
      return 4 * Math.abs(x - 0.5) - 1;
    }
    case "saw": {
      const x = p / TWO_PI;
      return 2 * (x - Math.floor(x + 0.5));
    }
    case "square":
      return p < Math.PI ? 1 : -1;
    case "pulse":
      return p < TWO_PI * clamp(pulseWidth, 0.01, 0.99) ? 1 : -1;
    default:
      return Math.sin(p);
  }
}

/**
 * Evaluate the spectral-envelope gain (linear) at a given frequency.
 * Combines a dB/octave tilt, piecewise-linear (freq,dB) control points, and
 * resonance peaks. `brightness` scales the tilt over time (from the brightness
 * mod envelope).
 */
function spectralGain(
  se: SpectralEnvelope,
  freq: number,
  refFreq: number,
  brightness: number,
): number {
  if (!se.enabled) return 1;
  let db = 0;
  // tilt (dB/octave) relative to the reference frequency
  if (se.tilt !== 0 && freq > 0 && refFreq > 0) {
    const octaves = Math.log2(freq / refFreq);
    db += se.tilt * brightness * octaves;
  }
  // piecewise-linear control points (freq -> gainDb)
  const pts = se.points;
  if (pts.length > 0) {
    if (freq <= pts[0].freq) db += pts[0].gainDb;
    else if (freq >= pts[pts.length - 1].freq) db += pts[pts.length - 1].gainDb;
    else {
      for (let i = 1; i < pts.length; i++) {
        if (freq <= pts[i].freq) {
          const a = pts[i - 1];
          const b = pts[i];
          const f = (freq - a.freq) / Math.max(1e-6, b.freq - a.freq);
          db += a.gainDb + (b.gainDb - a.gainDb) * f;
          break;
        }
      }
    }
  }
  let gain = Math.pow(10, db / 20);
  // resonance peaks (bell-shaped in linear gain)
  for (const peak of se.peaks) {
    const bw = Math.max(1, peak.bandwidth);
    const x = (freq - peak.freq) / bw;
    const resp = (peak.gain - 1) * Math.exp(-0.5 * x * x);
    gain *= 1 + resp;
  }
  return gain;
}

export interface RenderOptions {
  sampleRate?: number;
  duration?: number;
  normalize?: boolean;
  /**
   * Quality: number of partials to render at most (optimizer can lower this).
   * Defaults to all enabled partials.
   */
  maxPartials?: number;
}

export interface RenderResult {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

/**
 * Render the time-varying additive partial bank into `out` (added in place).
 */
function renderPartialBank(
  out: Float32Array,
  params: SynthParameters,
  f0Base: number,
  sampleRate: number,
  gain: number,
  maxPartials: number,
): void {
  const bank = params.partialBank;
  if (!bank.enabled || gain <= 0) return;
  const length = out.length;
  const B = Math.max(0, bank.inharmonicity);
  const se = params.spectralEnvelope;
  const pitchEnv = params.envelopes.pitch;
  const brightEnv = params.envelopes.brightness;
  const invLen = 1 / Math.max(1, length - 1);

  // Precompute pitch modulation ratio per (coarse) frame for speed.
  const nyquist = sampleRate * 0.5;

  let rendered = 0;
  for (let pi = 0; pi < bank.partials.length; pi++) {
    if (rendered >= maxPartials) break;
    const part = bank.partials[pi];
    if (!part.enabled || part.amplitude <= 0) continue;
    rendered++;

    const n = pi + 1;
    const stretch = B > 0 ? Math.sqrt(1 + B * n * n) : 1;
    const baseFreq = f0Base * part.frequencyRatio * stretch + part.frequencyOffset;
    if (baseFreq <= 0 || baseFreq >= nyquist) continue;

    const ampEnv = part.ampEnv;
    const freqEnv = part.freqEnv;
    const phase0 = part.phase;

    // Phase accumulation (accounts for time-varying frequency).
    let phase = phase0;
    for (let i = 0; i < length; i++) {
      const tn = i * invLen; // normalized time 0..1
      // frequency modulation: global pitch env (semitones) + per-partial freqEnv
      const semis = pitchEnv ? evalBreakpoints(pitchEnv, tn) : 0;
      const pitchRatio = semis !== 0 ? Math.pow(2, semis / 12) : 1;
      const fmul = freqEnv ? evalBreakpoints(freqEnv, tn) : 1;
      const freq = baseFreq * pitchRatio * fmul;
      if (freq >= nyquist) {
        phase += (TWO_PI * nyquist) / sampleRate;
        continue;
      }
      // amplitude
      let amp = part.amplitude;
      if (ampEnv) amp *= evalBreakpoints(ampEnv, tn);
      if (se.enabled) {
        const bright = brightEnv ? evalBreakpoints(brightEnv, tn) : 1;
        amp *= spectralGain(se, freq, f0Base, bright);
      }
      out[i] += amp * Math.sin(phase) * gain;
      phase += (TWO_PI * freq) / sampleRate;
    }
  }
}

/** Render basic oscillators + sub into `out` (added in place). */
function renderOscillators(
  out: Float32Array,
  params: SynthParameters,
  f0Base: number,
  sampleRate: number,
  gain: number,
): void {
  if (gain <= 0) return;
  const length = out.length;
  const pitchEnv = params.envelopes.pitch;
  const invLen = 1 / Math.max(1, length - 1);

  for (const o of params.oscillators) {
    if (!o.enabled || o.level <= 0) continue;
    const octaveMul = Math.pow(2, o.octave);
    const detune = Math.pow(2, o.detuneCents / 1200);
    let phase = o.phase;
    for (let i = 0; i < length; i++) {
      const tn = i * invLen;
      const semis = pitchEnv ? evalBreakpoints(pitchEnv, tn) : 0;
      const pitchRatio = semis !== 0 ? Math.pow(2, semis / 12) : 1;
      const freq = f0Base * octaveMul * detune * pitchRatio;
      out[i] += basicWave(o.waveform, phase, o.pulseWidth) * o.level * gain;
      phase += (TWO_PI * freq) / sampleRate;
    }
  }
}

function renderSub(
  out: Float32Array,
  sub: SubOscParams,
  f0Base: number,
  sampleRate: number,
  gain: number,
): void {
  if (!sub.enabled || sub.level <= 0 || gain <= 0) return;
  const length = out.length;
  const freq = f0Base / Math.pow(2, Math.max(0, sub.octavesBelow));
  let phase = 0;
  for (let i = 0; i < length; i++) {
    out[i] += basicWave(sub.waveform, phase, 0.5) * sub.level * gain;
    phase += (TWO_PI * freq) / sampleRate;
  }
}

/** Render the noise layer with LP/HP/tilt shaping (added in place). */
function renderNoise(
  out: Float32Array,
  params: SynthParameters,
  sampleRate: number,
  gain: number,
): void {
  const noise = params.noise;
  if (!noise.enabled || noise.level <= 0 || gain <= 0) return;
  const length = out.length;
  let n = generateNoise(length, noise.color, 24680);
  if (noise.highpass > 20) n = onePoleHighpass(n, noise.highpass, sampleRate);
  if (noise.lowpass < 20000) n = onePoleLowpass(n, noise.lowpass, sampleRate);
  // simple spectral tilt via a first-difference (bright) / integration (dark)
  if (noise.tilt > 0) {
    const k = Math.min(1, noise.tilt / 12);
    for (let i = length - 1; i > 0; i--) n[i] = n[i] - k * n[i - 1];
  } else if (noise.tilt < 0) {
    const k = Math.min(1, -noise.tilt / 12);
    for (let i = 1; i < length; i++) n[i] = n[i] + k * n[i - 1];
  }
  const noiseEnv = params.envelopes.noise;
  const invLen = 1 / Math.max(1, length - 1);
  for (let i = 0; i < length; i++) {
    const tn = i * invLen;
    const e = noiseEnv ? evalBreakpoints(noiseEnv, tn) : 1;
    out[i] += n[i] * noise.level * e * gain;
  }
}

/** Render the dedicated transient into `out` (added in place). */
function renderTransient(
  out: Float32Array,
  params: SynthParameters,
  f0Base: number,
  sampleRate: number,
  gain: number,
): void {
  const tr = params.transient;
  if (!tr.enabled || tr.level <= 0 || gain <= 0) return;
  const length = out.length;
  const trLen = Math.min(length, Math.max(1, Math.floor(tr.duration * sampleRate)));

  const startPitch = tr.pitch > 0 ? tr.pitch : f0Base * (1 + 2 * tr.brightness);
  // Band-limited noise burst for the transient.
  let trNoise = generateNoise(trLen, "white", 13579);
  if (tr.freqHigh < 20000) trNoise = onePoleLowpass(trNoise, tr.freqHigh, sampleRate);
  if (tr.freqLow > 20) trNoise = onePoleHighpass(trNoise, tr.freqLow, sampleRate);

  let phase = 0;
  for (let i = 0; i < trLen; i++) {
    const frac = i / trLen;
    const env = Math.exp(-5 * frac);
    // pitch decays downward over the transient (chirp)
    const freq = startPitch * (1 - tr.pitchDecay * frac);
    const tone = Math.sin(phase);
    phase += (TWO_PI * Math.max(1, freq)) / sampleRate;
    const val = tr.harmonicAmount * tone + tr.noiseAmount * trNoise[i];
    out[i] += val * env * tr.level * gain;
  }
}

/**
 * Render a full note to a mono buffer.
 */
export function renderSynth(
  params: SynthParameters,
  opts: RenderOptions = {},
): RenderResult {
  const sampleRate = opts.sampleRate ?? 44100;
  const duration = opts.duration ?? noteDuration(params);
  const length = Math.max(1, Math.floor(duration * sampleRate));
  const f0Base = clamp(params.fundamental, 10, sampleRate * 0.45);
  const mx = params.mixer;
  const maxPartials = opts.maxPartials ?? params.partialBank.partials.length;

  // Render tonal layers into separate accumulation, mix, then apply master env.
  const tonal = new Float32Array(length);
  renderPartialBank(tonal, params, f0Base, sampleRate, mx.partials * params.partialBank.level, maxPartials);
  renderOscillators(tonal, params, f0Base, sampleRate, mx.osc);
  renderSub(tonal, params.sub, f0Base, sampleRate, mx.sub);

  // Master amplitude envelope on the tonal sum.
  const ampEnv = params.envelopes.amplitude;
  const invLen = 1 / Math.max(1, length - 1);
  for (let i = 0; i < length; i++) {
    const tn = i * invLen;
    tonal[i] *= evalBreakpoints(ampEnv, tn);
  }

  // Noise + transient are mixed in with their own envelopes (not the master amp env).
  renderNoise(tonal, params, sampleRate, mx.noise);
  renderTransient(tonal, params, f0Base, sampleRate, mx.transient);

  // Filter.
  let filtered = tonal;
  const fp = params.filter;
  if (fp.type !== "none") {
    const kind: BiquadKind = fp.type;
    const filtEnv = params.envelopes.filter;
    const cutoffAt = (i: number) => {
      const tn = i * invLen;
      const mod = fp.envAmount * (filtEnv ? evalBreakpoints(filtEnv, tn) : 0);
      return clamp(fp.cutoff + mod, 20, sampleRate * 0.49);
    };
    filtered = applyBiquad(tonal, kind, cutoffAt, fp.resonance, sampleRate);
  }

  // Master gain.
  for (let i = 0; i < length; i++) filtered[i] *= mx.master;

  // Optional peak normalization.
  if (opts.normalize !== false) {
    let max = 0;
    for (let i = 0; i < length; i++) {
      const a = Math.abs(filtered[i]);
      if (a > max) max = a;
    }
    if (max > 1) {
      const g = 0.99 / max;
      for (let i = 0; i < length; i++) filtered[i] *= g;
    }
  }

  return { samples: filtered, sampleRate, duration };
}

/**
 * Generate a single-cycle waveform (one period) from the partial bank, for the
 * waveform editor / display. Uses the partials' peak amplitudes at t=0.
 */
export function renderSingleCycle(
  params: SynthParameters,
  length = 512,
): Float32Array {
  const out = new Float32Array(length);
  const bank = params.partialBank;
  const B = Math.max(0, bank.inharmonicity);
  const se = params.spectralEnvelope;
  const f0 = params.fundamental;
  for (let pi = 0; pi < bank.partials.length; pi++) {
    const part = bank.partials[pi];
    if (!part.enabled || part.amplitude <= 0) continue;
    const n = pi + 1;
    const stretch = B > 0 ? Math.sqrt(1 + B * n * n) : 1;
    const ratio = part.frequencyRatio * stretch;
    let amp = part.amplitude;
    if (part.ampEnv) {
      // Use the envelope's PEAK for the display cycle (many envelopes start at
      // 0 at t=0, which would otherwise render a silent single cycle).
      let m = 0;
      for (const pt of part.ampEnv.points) m = Math.max(m, pt.v);
      amp *= m;
    }
    if (se.enabled) amp *= spectralGain(se, f0 * ratio, f0, 1);
    for (let i = 0; i < length; i++) {
      const ph = (TWO_PI * ratio * i) / length + part.phase;
      out[i] += amp * Math.sin(ph);
    }
  }
  // normalize for display
  let max = 0;
  for (let i = 0; i < length; i++) max = Math.max(max, Math.abs(out[i]));
  if (max > 1e-9) for (let i = 0; i < length; i++) out[i] /= max;
  return out;
}
