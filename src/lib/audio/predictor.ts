/**
 * Parameter prediction.
 *
 * Maps a detailed AudioAnalysis onto the high-dimensional SynthParameters so
 * the reconstruction starts from an informed guess. The heuristic predictor
 * uses:
 *   - per-partial PEAK amplitudes + measured frequency ratios (inharmonicity)
 *   - per-partial TIME-VARYING amplitude envelopes (from tracked trajectories)
 *   - a spectral envelope from the analysis
 *   - amplitude / brightness envelopes from the RMS + flux curves
 *   - transient + noise layers when the attack / noisiness warrant them
 *
 * The `ParameterPredictor` interface is preserved so a NeuralParameterPredictor
 * can drop in later without touching the rest of the app.
 */

import type { AudioAnalysis } from "./analysis";
import {
  adsrToBreakpoints,
  type BreakpointEnvelope,
  cloneParameters,
  defaultADSR,
  defaultParameters,
  type EnvelopePoint,
  type Partial,
  type SynthParameters,
} from "../synth/params";

export interface ParameterPredictor {
  readonly name: string;
  predict(analysis: AudioAnalysis): SynthParameters;
}

/** Convert a per-frame trajectory (0..1) into a compact breakpoint envelope. */
function trajectoryToEnvelope(traj: number[]): BreakpointEnvelope | undefined {
  if (!traj || traj.length < 2) return undefined;
  const n = traj.length;
  // Downsample to at most ~8 points to keep the parameter vector manageable.
  const maxPoints = 8;
  const stride = Math.max(1, Math.floor(n / maxPoints));
  const points: EnvelopePoint[] = [];
  for (let i = 0; i < n; i += stride) {
    points.push({ t: i / (n - 1), v: Math.max(0, Math.min(1, traj[i])) });
  }
  // ensure last point present
  if (points[points.length - 1].t < 1) {
    points.push({ t: 1, v: Math.max(0, Math.min(1, traj[n - 1])) });
  }
  return { points };
}

export class HeuristicParameterPredictor implements ParameterPredictor {
  readonly name = "Heuristic";

  predict(analysis: AudioAnalysis): SynthParameters {
    const p = defaultParameters();
    p.name = "From Analysis";
    p.fundamental = analysis.fundamental;
    p.duration = Math.max(0.2, analysis.duration);

    // --- Partial bank from tracked harmonics -----------------------------
    const measured = analysis.harmonics;
    const count = Math.max(32, measured.length);
    const partials: Partial[] = [];
    for (let i = 0; i < count; i++) {
      const m = measured[i];
      if (m) {
        partials.push({
          enabled: m.relative > 0.001,
          // Use measured ratio so inharmonic partials land correctly.
          frequencyRatio: isFinite(m.ratio) && m.ratio > 0 ? m.ratio * (i + 1) : i + 1,
          frequencyOffset: 0,
          amplitude: m.relative,
          phase: 0,
          ampEnv: trajectoryToEnvelope(m.trajectory),
        });
      } else {
        partials.push({
          enabled: false,
          frequencyRatio: i + 1,
          frequencyOffset: 0,
          amplitude: 0,
          phase: 0,
        });
      }
    }
    p.partialBank.enabled = true;
    p.partialBank.partials = partials;
    // We baked measured ratios into frequencyRatio, so keep global B at 0 but
    // also record the estimate for the UI/optimizer to nudge.
    p.partialBank.inharmonicity = 0;
    p.partialBank.level = 0.95;

    // --- Master amplitude envelope from the RMS envelope -----------------
    p.envelopes.amplitude = rmsToEnvelope(analysis);

    // --- Brightness envelope from spectral flux --------------------------
    // If the spectrum evolves a lot, let brightness ride down over time.
    p.envelopes.brightness = brightnessFromFlux(analysis);

    // --- Spectral envelope ----------------------------------------------
    if (analysis.spectralEnvelope.length > 1) {
      p.spectralEnvelope.enabled = true;
      p.spectralEnvelope.tilt = 0;
      p.spectralEnvelope.points = analysis.spectralEnvelope.map((sp) => ({
        freq: sp.freq,
        gainDb: sp.gainDb,
      }));
      p.spectralEnvelope.peaks = [];
    }

    // --- Mixer: partial bank dominant ------------------------------------
    p.mixer.partials = 1.0;
    p.mixer.osc = 0.0;
    p.mixer.sub = 0.0;

    // --- Transient: enable for fast attacks ------------------------------
    const attack = analysis.envelope.attack;
    if (attack < 0.02) {
      p.transient.enabled = true;
      p.transient.level = 0.3;
      p.transient.duration = Math.max(0.005, attack * 2 + 0.008);
      p.transient.brightness = Math.min(1, analysis.spectralCentroid / 6000);
      p.transient.noiseAmount = 0.4 + 0.4 * analysis.noisiness;
      p.transient.harmonicAmount = 0.6;
      p.transient.pitch = 0;
      p.transient.pitchDecay = 0.5;
      p.transient.freqLow = 200;
      p.transient.freqHigh = Math.max(4000, analysis.spectralRolloff);
      p.mixer.transient = 0.5;
    } else {
      p.transient.enabled = false;
      p.mixer.transient = 0;
    }

    // --- Noise: enable when the sound is noisy ---------------------------
    if (analysis.noisiness > 0.25) {
      p.noise.enabled = true;
      p.noise.color = "pink";
      p.noise.level = Math.min(0.5, analysis.noisiness);
      p.noise.lowpass = Math.max(3000, analysis.spectralRolloff);
      p.noise.highpass = 100;
      p.noise.tilt = 0;
      p.envelopes.noise = adsrToBreakpoints(
        {
          ...defaultADSR(),
          attack: Math.max(0.001, attack),
          sustain: analysis.noisiness,
        },
        p.duration,
      );
      p.mixer.noise = Math.min(0.6, analysis.noisiness);
    } else {
      p.noise.enabled = false;
      p.mixer.noise = 0;
    }

    p.filter.type = "none";
    p.mixer.master = 0.9;
    return cloneParameters(p);
  }
}

/** Downsample the analysis RMS curve into an amplitude breakpoint envelope. */
function rmsToEnvelope(analysis: AudioAnalysis): BreakpointEnvelope {
  const curve = analysis.envelope.curve;
  if (curve.length < 2) {
    return adsrToBreakpoints(defaultADSR(), analysis.duration);
  }
  const maxPoints = 12;
  const stride = Math.max(1, Math.floor(curve.length / maxPoints));
  const points: EnvelopePoint[] = [];
  for (let i = 0; i < curve.length; i += stride) {
    points.push({ t: i / (curve.length - 1), v: Math.max(0, Math.min(1, curve[i])) });
  }
  if (points[points.length - 1].t < 1) {
    points.push({ t: 1, v: Math.max(0, Math.min(1, curve[curve.length - 1])) });
  }
  // ensure it starts at (or near) 0 for a clean attack
  if (points[0].t > 0) points.unshift({ t: 0, v: 0 });
  return { points };
}

/** Derive a brightness envelope: brighter at onset, settling over the note. */
function brightnessFromFlux(analysis: AudioAnalysis): BreakpointEnvelope {
  // Simple heuristic: start slightly bright, decay to 1.0. Scale by meanFlux.
  const start = 1 + Math.min(0.5, analysis.meanFlux);
  return { points: [
    { t: 0, v: start },
    { t: 0.15, v: 1.05 },
    { t: 1, v: 0.9 },
  ] };
}

export const defaultPredictor: ParameterPredictor = new HeuristicParameterPredictor();
