/**
 * Parameter representation for the high-dimensional synthesis engine.
 *
 * This is a *generic* mathematical sound-reconstruction model, not a clone of
 * any commercial synth's preset format. It is intentionally serialisable to
 * plain JSON so presets can be exported/imported and predicted by future AI
 * models.
 *
 * Core idea (why this can reconstruct complex sounds): the tonal signal is a
 * bank of many partials, each with its OWN time-varying amplitude (and
 * optionally frequency) trajectory:
 *
 *     x(t) = Σ_n  A_n(t) · sin( 2π · f_n(t) · t + φ_n )
 *
 * where A_n(t) is a breakpoint envelope and f_n = f0·(ratio_n) + offset_n.
 * This lets the timbre EVOLVE over the note (bright attack → darker decay),
 * supports INHARMONIC partials (piano/bell), and can acquire far more spectral
 * structure than a fixed sine/saw/triangle/square waveform.
 */

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

/** A single breakpoint: normalized time (0..1 of note) -> value. */
export interface EnvelopePoint {
  /** normalized time 0..1 across the note duration */
  t: number;
  /** value at this time */
  v: number;
}

/**
 * A breakpoint envelope with arbitrary control points. Points are kept sorted
 * by time. Linear interpolation between points; held flat outside the range.
 * This replaces rigid ADSR for anything that benefits from arbitrary shapes,
 * while `adsrToBreakpoints` keeps ADSR ergonomics available in the UI.
 */
export interface BreakpointEnvelope {
  points: EnvelopePoint[];
}

/** Classic ADSR (still offered in the UI as a convenient shape generator). */
export interface ADSRParams {
  attack: number; // seconds
  decay: number; // seconds
  sustain: number; // 0..1
  release: number; // seconds
  hold: number; // seconds at sustain before release
}

// ---------------------------------------------------------------------------
// Partials (high-resolution additive bank)
// ---------------------------------------------------------------------------

/**
 * A single partial in the additive bank.
 *
 * frequency = fundamental * frequencyRatio + frequencyOffset
 * amplitude(t) = amplitude * ampEnv(t)   (ampEnv defaults to flat 1.0)
 * frequency(t) = base freq * (freqEnv(t) if present, else 1)
 */
export interface Partial {
  enabled: boolean;
  /** multiple of the fundamental (1 == fundamental, 2.013 == stretched H2) */
  frequencyRatio: number;
  /** absolute Hz offset added on top of the ratio (for detune/beating) */
  frequencyOffset: number;
  /** peak linear amplitude (0..1, relative to loudest partial) */
  amplitude: number;
  /** phase offset in radians */
  phase: number;
  /**
   * Optional per-partial amplitude envelope (normalized time 0..1 -> gain).
   * When absent, the partial uses a flat amplitude scaled by the layer amp env.
   */
  ampEnv?: BreakpointEnvelope;
  /**
   * Optional per-partial frequency multiplier envelope (normalized time ->
   * multiplier around 1.0), for pitch glides / partial detuning over time.
   */
  freqEnv?: BreakpointEnvelope;
}

/** The additive partial bank layer. */
export interface PartialBankParams {
  enabled: boolean;
  level: number;
  partials: Partial[];
  /**
   * Global stiff-string inharmonicity coefficient B applied on top of each
   * partial's ratio: f_n *= sqrt(1 + B n^2). 0 == use ratios as-is.
   */
  inharmonicity: number;
}

// ---------------------------------------------------------------------------
// Spectral envelope (formant / resonance shaping of the partial bank)
// ---------------------------------------------------------------------------

/** A resonance/formant peak added on top of the base spectral tilt. */
export interface ResonancePeak {
  /** center frequency in Hz */
  freq: number;
  /** linear gain multiplier at the peak (1 == no change) */
  gain: number;
  /** bandwidth in Hz (wider = broader resonance) */
  bandwidth: number;
}

/**
 * A higher-level spectral envelope that shapes partial amplitudes as a function
 * of frequency. Represented as (frequency, gain-in-dB) control points plus a
 * set of resonance peaks. Partial gain = interp(points) * Π peak-responses.
 */
export interface SpectralEnvelope {
  enabled: boolean;
  /** overall tilt in dB/octave (brightness) */
  tilt: number;
  /** (frequency Hz, gain dB) control points, sorted by frequency */
  points: { freq: number; gainDb: number }[];
  /** resonance/formant peaks */
  peaks: ResonancePeak[];
}

// ---------------------------------------------------------------------------
// Basic oscillator layer (still supported)
// ---------------------------------------------------------------------------

export type OscillatorWaveform =
  | "sine"
  | "triangle"
  | "saw"
  | "square"
  | "pulse"
  | "custom"; // "custom" renders the partial bank as its waveform

export interface OscillatorParams {
  enabled: boolean;
  waveform: OscillatorWaveform;
  level: number;
  detuneCents: number;
  phase: number;
  sync: boolean;
  /** pulse width for the "pulse" waveform (0..1) */
  pulseWidth: number;
  /** octave offset (-2..+2) */
  octave: number;
}

/** Sub oscillator: a simple sine/square an octave (or more) below. */
export interface SubOscParams {
  enabled: boolean;
  waveform: "sine" | "square" | "triangle";
  level: number;
  /** octaves below the fundamental (usually 1) */
  octavesBelow: number;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

export type FilterType = "lowpass" | "highpass" | "bandpass" | "none";

export interface FilterParams {
  type: FilterType;
  cutoff: number; // Hz
  resonance: number; // Q
  /** Hz added to cutoff, scaled by the filter modulation envelope */
  envAmount: number;
}

// ---------------------------------------------------------------------------
// Noise (with spectral shaping)
// ---------------------------------------------------------------------------

export type NoiseColor = "white" | "pink" | "brown";

export interface NoiseParams {
  enabled: boolean;
  color: NoiseColor;
  level: number;
  /** low-pass cutoff Hz (20000 == effectively open) */
  lowpass: number;
  /** high-pass cutoff Hz (20 == effectively open) */
  highpass: number;
  /** spectral tilt in dB/octave applied to the noise */
  tilt: number;
}

// ---------------------------------------------------------------------------
// Transient (dedicated, richer)
// ---------------------------------------------------------------------------

export interface TransientParams {
  enabled: boolean;
  level: number;
  duration: number; // seconds
  /** starting pitch in Hz for the tonal click (0 == derive from fundamental) */
  pitch: number;
  /** how fast the transient pitch decays (0..1, higher = faster downward chirp) */
  pitchDecay: number;
  brightness: number; // 0..1
  /** noise vs tonal balance 0..1 */
  noiseAmount: number;
  /** harmonic (tonal) content amount 0..1 */
  harmonicAmount: number;
  /** low frequency bound Hz for the transient noise band */
  freqLow: number;
  /** high frequency bound Hz for the transient noise band */
  freqHigh: number;
}

// ---------------------------------------------------------------------------
// Modulation envelopes (independent, arbitrary control points)
// ---------------------------------------------------------------------------

/**
 * Independent modulation envelopes. Each targets a different aspect of the
 * sound and is NOT forced to share the amplitude ADSR.
 */
export interface ModEnvelopes {
  /** master amplitude envelope (0..1) applied to the whole tonal mix */
  amplitude: BreakpointEnvelope;
  /** filter cutoff modulation (0..1, scaled by FilterParams.envAmount) */
  filter: BreakpointEnvelope;
  /** pitch modulation in semitones (value = semitone offset) */
  pitch: BreakpointEnvelope;
  /** harmonic brightness (0..1): scales spectral tilt over time */
  brightness: BreakpointEnvelope;
  /** noise layer amplitude (0..1) */
  noise: BreakpointEnvelope;
}

// ---------------------------------------------------------------------------
// Top-level parameters
// ---------------------------------------------------------------------------

export interface Mixer {
  osc: number;
  partials: number;
  sub: number;
  noise: number;
  transient: number;
  master: number;
}

export interface SynthParameters {
  name: string;
  version: number;
  fundamental: number;
  /** total note duration in seconds (envelopes are normalized to this) */
  duration: number;

  oscillators: OscillatorParams[];
  sub: SubOscParams;
  partialBank: PartialBankParams;
  spectralEnvelope: SpectralEnvelope;
  filter: FilterParams;
  noise: NoiseParams;
  transient: TransientParams;
  envelopes: ModEnvelopes;
  mixer: Mixer;
}

// ---------------------------------------------------------------------------
// Defaults & constructors
// ---------------------------------------------------------------------------

/** Default number of partials to allocate. Architecture supports 128+. */
export const DEFAULT_PARTIAL_COUNT = 64;
export const MAX_PARTIALS = 128;

export function defaultADSR(): ADSRParams {
  return { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.4, hold: 0.3 };
}

/** A flat envelope holding a constant value. */
export function flatEnvelope(v = 1): BreakpointEnvelope {
  return { points: [{ t: 0, v }, { t: 1, v }] };
}

/** Convert ADSR (seconds) into normalized-time breakpoints for a duration. */
export function adsrToBreakpoints(
  env: ADSRParams,
  duration: number,
): BreakpointEnvelope {
  const d = Math.max(0.01, duration);
  const a = env.attack;
  const dec = a + env.decay;
  const relStart = dec + env.hold;
  const rel = relStart + env.release;
  const pts: EnvelopePoint[] = [
    { t: 0, v: 0 },
    { t: Math.min(1, a / d), v: 1 },
    { t: Math.min(1, dec / d), v: env.sustain },
    { t: Math.min(1, relStart / d), v: env.sustain },
    { t: Math.min(1, rel / d), v: 0 },
  ];
  // ensure strictly sorted & clamped
  return { points: dedupeSorted(pts) };
}

function dedupeSorted(pts: EnvelopePoint[]): EnvelopePoint[] {
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  const out: EnvelopePoint[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - p.t) < 1e-4) {
      out[out.length - 1] = p; // keep latest at same time
    } else {
      out.push({ t: Math.max(0, Math.min(1, p.t)), v: p.v });
    }
  }
  if (out.length === 0) out.push({ t: 0, v: 0 }, { t: 1, v: 0 });
  return out;
}

/** Evaluate a breakpoint envelope at normalized time (0..1). */
export function evalBreakpoints(env: BreakpointEnvelope, tn: number): number {
  const pts = env.points;
  if (pts.length === 0) return 0;
  if (tn <= pts[0].t) return pts[0].v;
  if (tn >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
  for (let i = 1; i < pts.length; i++) {
    if (tn <= pts[i].t) {
      const a = pts[i - 1];
      const b = pts[i];
      const span = b.t - a.t;
      const f = span <= 1e-9 ? 0 : (tn - a.t) / span;
      return a.v + (b.v - a.v) * f;
    }
  }
  return pts[pts.length - 1].v;
}

/** Build a default partial bank with a gentle 1/n rolloff. */
export function makeDefaultPartials(count: number): Partial[] {
  const out: Partial[] = [];
  for (let n = 0; n < count; n++) {
    out.push({
      enabled: true,
      frequencyRatio: n + 1,
      frequencyOffset: 0,
      amplitude: n === 0 ? 1 : 1 / (n + 1),
      phase: 0,
    });
  }
  return out;
}

export function defaultModEnvelopes(): ModEnvelopes {
  return {
    amplitude: adsrToBreakpoints(defaultADSR(), 1.13),
    filter: flatEnvelope(0),
    pitch: flatEnvelope(0),
    brightness: flatEnvelope(1),
    noise: flatEnvelope(0),
  };
}

export function defaultSpectralEnvelope(): SpectralEnvelope {
  return {
    enabled: false,
    tilt: 0,
    points: [
      { freq: 50, gainDb: 0 },
      { freq: 500, gainDb: 0 },
      { freq: 2000, gainDb: 0 },
      { freq: 8000, gainDb: 0 },
      { freq: 16000, gainDb: 0 },
    ],
    peaks: [],
  };
}

export function defaultParameters(): SynthParameters {
  const duration = 1.13;
  return {
    name: "Init Patch",
    version: 2,
    fundamental: 261.63,
    duration,
    oscillators: [
      {
        enabled: false,
        waveform: "saw",
        level: 0.8,
        detuneCents: 0,
        phase: 0,
        sync: false,
        pulseWidth: 0.5,
        octave: 0,
      },
      {
        enabled: false,
        waveform: "sine",
        level: 0.2,
        detuneCents: 7,
        phase: 0,
        sync: false,
        pulseWidth: 0.5,
        octave: 0,
      },
    ],
    sub: { enabled: false, waveform: "sine", level: 0.3, octavesBelow: 1 },
    partialBank: {
      enabled: true,
      level: 0.9,
      partials: makeDefaultPartials(DEFAULT_PARTIAL_COUNT),
      inharmonicity: 0,
    },
    spectralEnvelope: defaultSpectralEnvelope(),
    filter: { type: "none", cutoff: 12000, resonance: 0.7, envAmount: 0 },
    noise: {
      enabled: false,
      color: "white",
      level: 0.1,
      lowpass: 20000,
      highpass: 20,
      tilt: 0,
    },
    transient: {
      enabled: false,
      level: 0.3,
      duration: 0.03,
      pitch: 0,
      pitchDecay: 0.5,
      brightness: 0.6,
      noiseAmount: 0.5,
      harmonicAmount: 0.5,
      freqLow: 200,
      freqHigh: 8000,
    },
    envelopes: defaultModEnvelopes(),
    mixer: {
      osc: 0.0,
      partials: 1.0,
      sub: 0.0,
      noise: 0.0,
      transient: 0.0,
      master: 0.85,
    },
  };
}

/** Deep clone that survives JSON round-trips (parameters are plain data). */
export function cloneParameters(p: SynthParameters): SynthParameters {
  return JSON.parse(JSON.stringify(p));
}

// ---------------------------------------------------------------------------
// Back-compat migration from the old v1 parameter format
// ---------------------------------------------------------------------------

/**
 * Migrate an old (v1) parameter object to the new v2 model so previously saved
 * presets / exported JSON keep loading.
 */
// eslint-disable-next-line
export function migrateParameters(raw: any): SynthParameters {
  if (!raw || typeof raw !== "object") return defaultParameters();
  // Already v2?
  if (raw.version >= 2 && raw.partialBank && raw.mixer) {
    return raw as SynthParameters;
  }
  // v1 -> v2
  const p = defaultParameters();
  p.name = raw.name ?? p.name;
  p.fundamental = raw.fundamental ?? p.fundamental;
  const oldEnv = raw.envelope;
  const dur =
    oldEnv
      ? Math.max(
          0.2,
          (oldEnv.attack ?? 0) +
            (oldEnv.decay ?? 0) +
            (oldEnv.hold ?? 0) +
            (oldEnv.release ?? 0),
        )
      : p.duration;
  p.duration = dur;

  if (Array.isArray(raw.harmonicBank?.harmonics)) {
    const hs = raw.harmonicBank.harmonics;
    const partials: Partial[] = hs.map((h: any, i: number) => ({
      enabled: true,
      frequencyRatio: i + 1,
      frequencyOffset: 0,
      amplitude: h.amplitude ?? 0,
      phase: h.phase ?? 0,
    }));
    // pad up to default count
    for (let i = partials.length; i < DEFAULT_PARTIAL_COUNT; i++) {
      partials.push({
        enabled: true,
        frequencyRatio: i + 1,
        frequencyOffset: 0,
        amplitude: 0,
        phase: 0,
      });
    }
    p.partialBank.partials = partials;
    p.partialBank.inharmonicity = raw.harmonicBank.inharmonicity ?? 0;
    p.partialBank.level = raw.harmonicBank.level ?? 0.9;
  }
  if (oldEnv) {
    p.envelopes.amplitude = adsrToBreakpoints(oldEnv, dur);
  }
  if (raw.filter) {
    p.filter.type = raw.filter.type ?? "none";
    p.filter.cutoff = raw.filter.cutoff ?? 12000;
    p.filter.resonance = raw.filter.resonance ?? 0.7;
    p.filter.envAmount = raw.filter.envAmount ?? 0;
  }
  if (raw.noise) {
    p.noise.enabled = raw.noise.enabled ?? false;
    p.noise.color = raw.noise.color ?? "white";
    p.noise.level = raw.noise.level ?? 0.1;
    p.noise.lowpass = raw.noise.cutoff ?? 20000;
    p.mixer.noise = raw.noise.enabled ? 1 : 0;
  }
  if (raw.transient) {
    p.transient.enabled = raw.transient.enabled ?? false;
    p.transient.level = raw.transient.level ?? 0.3;
    p.transient.duration = raw.transient.duration ?? 0.03;
    p.transient.brightness = raw.transient.brightness ?? 0.6;
    p.transient.noiseAmount = raw.transient.noise ?? 0.5;
    p.mixer.transient = raw.transient.enabled ? 1 : 0;
  }
  p.mixer.partials = 1;
  p.mixer.master = raw.masterGain ?? 0.85;
  return p;
}
