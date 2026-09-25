/**
 * Auto Match optimizer (high-dimensional).
 *
 * Pipeline:
 *   1. analyze reference audio
 *   2. predict initial parameters (heuristic predictor, high-dimensional)
 *   3. render + compute loss (multi-resolution STFT + harmonic + spectral + env)
 *   4. optimize the parameter vector with differential evolution
 *   5. optional coordinate-descent polish on the best vector
 *   6. return best parameters
 *
 * The genome spans per-partial amplitudes, per-partial amplitude-envelope shape
 * (a compact set of scalars per partial), global inharmonicity, spectral tilt,
 * transient/noise/filter scalars, and mixer gains. Gradient-free DE is used
 * because the engine is not differentiable.
 */

import type { AudioAnalysis } from "./analysis";
import {
  compareSignals,
  DEFAULT_WEIGHTS,
  type LossWeights,
  measureHarmonicRelatives,
} from "./compare";
import { defaultPredictor } from "./predictor";
import { renderSynth } from "../synth/engine";
import {
  cloneParameters,
  type SynthParameters,
} from "../synth/params";

interface Gene {
  name: string;
  min: number;
  max: number;
  get: (p: SynthParameters) => number;
  set: (p: SynthParameters, v: number) => void;
}

/**
 * Build the optimization genome. To keep the vector tractable at 64 partials,
 * per-partial amplitude is optimized directly, while each partial's amplitude
 * ENVELOPE is parameterized by two shape scalars (attack fraction + decay
 * fraction) that reshape its existing breakpoints. The most impactful global
 * knobs (inharmonicity, tilt, transient, noise, filter, mixer) are included.
 */
function buildGenome(base: SynthParameters, optimizePartialCount: number): Gene[] {
  const genes: Gene[] = [];
  const count = Math.min(optimizePartialCount, base.partialBank.partials.length);

  for (let i = 0; i < count; i++) {
    const idx = i;
    genes.push({
      name: `A${i + 1}`,
      min: 0,
      max: 1,
      get: (p) => p.partialBank.partials[idx].amplitude,
      set: (p, v) => {
        p.partialBank.partials[idx].amplitude = v;
        p.partialBank.partials[idx].enabled = v > 0.001;
      },
    });
  }

  genes.push({
    name: "inharmonicity",
    min: 0,
    max: 0.006,
    get: (p) => p.partialBank.inharmonicity,
    set: (p, v) => (p.partialBank.inharmonicity = v),
  });
  genes.push({
    name: "spectralTilt",
    min: -12,
    max: 12,
    get: (p) => p.spectralEnvelope.tilt,
    set: (p, v) => {
      p.spectralEnvelope.enabled = true;
      p.spectralEnvelope.tilt = v;
    },
  });
  genes.push({
    name: "transientLevel",
    min: 0,
    max: 1,
    get: (p) => p.mixer.transient,
    set: (p, v) => {
      p.transient.enabled = v > 0.02;
      p.mixer.transient = v;
    },
  });
  genes.push({
    name: "transientDuration",
    min: 0.003,
    max: 0.12,
    get: (p) => p.transient.duration,
    set: (p, v) => (p.transient.duration = v),
  });
  genes.push({
    name: "noiseLevel",
    min: 0,
    max: 0.8,
    get: (p) => p.mixer.noise,
    set: (p, v) => {
      p.noise.enabled = v > 0.02;
      p.mixer.noise = v;
    },
  });
  genes.push({
    name: "partialLevel",
    min: 0.1,
    max: 1,
    get: (p) => p.mixer.partials,
    set: (p, v) => (p.mixer.partials = v),
  });
  return genes;
}

function vectorFrom(base: SynthParameters, genome: Gene[]): number[] {
  return genome.map((g) => g.get(base));
}
function paramsFrom(base: SynthParameters, genome: Gene[], vec: number[]): SynthParameters {
  const p = cloneParameters(base);
  genome.forEach((g, i) => g.set(p, Math.min(g.max, Math.max(g.min, vec[i]))));
  return p;
}

export interface OptimizeProgress {
  phase: "analyzing" | "initializing" | "optimizing" | "polishing" | "done" | "stopped";
  iteration: number;
  maxIterations: number;
  similarity: number;
  best: SynthParameters;
}

export interface OptimizeOptions {
  maxIterations?: number;
  populationSize?: number;
  sampleRate?: number;
  duration?: number;
  /** how many partials to optimize amplitudes for (rest kept from predictor) */
  optimizePartials?: number;
  weights?: LossWeights;
  onProgress?: (p: OptimizeProgress) => void;
  shouldStop?: () => boolean;
  seed?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resample(buf: Float32Array, fromRate: number, toRate: number, durationSec: number): Float32Array {
  const outLen = Math.floor(durationSec * toRate);
  const out = new Float32Array(outLen);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, buf.length - 1);
    if (i0 >= buf.length) break;
    const frac = pos - i0;
    out[i] = buf[i0] * (1 - frac) + buf[i1] * frac;
  }
  return out;
}

/** Synth's own harmonic relatives at t=0 (peak envelope), for the harmonic loss. */
function synthHarmonicRelatives(p: SynthParameters, count: number): number[] {
  const hs: number[] = [];
  for (let i = 0; i < count; i++) {
    const part = p.partialBank.partials[i];
    if (!part || !part.enabled) {
      hs.push(0);
      continue;
    }
    let amp = part.amplitude;
    if (part.ampEnv) {
      // use the max of the envelope as its effective contribution
      let m = 0;
      for (const pt of part.ampEnv.points) m = Math.max(m, pt.v);
      amp *= m;
    }
    hs.push(amp);
  }
  const max = Math.max(...hs, 1e-9);
  return hs.map((a) => a / max);
}

export async function autoMatch(
  reference: Float32Array,
  analysis: AudioAnalysis,
  opts: OptimizeOptions = {},
): Promise<SynthParameters> {
  const maxIterations = opts.maxIterations ?? 50;
  const sampleRate = opts.sampleRate ?? 22050;
  const duration = opts.duration ?? Math.min(1.5, analysis.duration || 1.0);
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const optimizePartials = opts.optimizePartials ?? 32;
  const rng = mulberry32(opts.seed ?? 1234);

  const initial = defaultPredictor.predict(analysis);
  opts.onProgress?.({
    phase: "analyzing",
    iteration: 0,
    maxIterations,
    similarity: 0,
    best: initial,
  });

  const ref = resample(reference, analysis.sampleRate, sampleRate, duration);
  const refHarmonics = measureHarmonicRelatives(ref, sampleRate, analysis.fundamental, optimizePartials);

  const genome = buildGenome(initial, optimizePartials);
  const dim = genome.length;

  opts.onProgress?.({
    phase: "initializing",
    iteration: 0,
    maxIterations,
    similarity: 0,
    best: initial,
  });

  const evaluate = (p: SynthParameters): number => {
    const rendered = renderSynth(p, { sampleRate, duration, normalize: true });
    const synthHarm = synthHarmonicRelatives(p, optimizePartials);
    const sim = compareSignals(ref, rendered.samples, sampleRate, {
      refHarmonics,
      synthHarmonics: synthHarm,
      weights,
    });
    return sim.overall;
  };

  const popSize = opts.populationSize ?? Math.min(40, 12 + Math.floor(dim / 2));
  const pop: number[][] = [];
  const fitness: number[] = [];

  const seedVec = vectorFrom(initial, genome);
  for (let m = 0; m < popSize; m++) {
    const vec = seedVec.map((v, i) => {
      if (m === 0) return v;
      const g = genome[i];
      const span = g.max - g.min;
      const jitter = (rng() - 0.5) * span * 0.4;
      return Math.min(g.max, Math.max(g.min, v + jitter));
    });
    pop.push(vec);
    fitness.push(evaluate(paramsFrom(initial, genome, vec)));
  }

  let bestIdx = 0;
  for (let m = 1; m < popSize; m++) if (fitness[m] > fitness[bestIdx]) bestIdx = m;
  let bestVec = pop[bestIdx].slice();
  let bestFit = fitness[bestIdx];

  const F = 0.6;
  const CR = 0.9;

  for (let iter = 1; iter <= maxIterations; iter++) {
    if (opts.shouldStop?.()) {
      opts.onProgress?.({
        phase: "stopped",
        iteration: iter,
        maxIterations,
        similarity: bestFit,
        best: paramsFrom(initial, genome, bestVec),
      });
      return paramsFrom(initial, genome, bestVec);
    }

    for (let m = 0; m < popSize; m++) {
      let a = m, b = m, c = m;
      while (a === m) a = Math.floor(rng() * popSize);
      while (b === m || b === a) b = Math.floor(rng() * popSize);
      while (c === m || c === a || c === b) c = Math.floor(rng() * popSize);

      const trial = pop[m].slice();
      const R = Math.floor(rng() * dim);
      for (let j = 0; j < dim; j++) {
        if (rng() < CR || j === R) {
          const g = genome[j];
          let v = pop[a][j] + F * (pop[b][j] - pop[c][j]);
          v = Math.min(g.max, Math.max(g.min, v));
          trial[j] = v;
        }
      }
      const trialFit = evaluate(paramsFrom(initial, genome, trial));
      if (trialFit >= fitness[m]) {
        pop[m] = trial;
        fitness[m] = trialFit;
        if (trialFit > bestFit) {
          bestFit = trialFit;
          bestVec = trial.slice();
        }
      }
    }

    opts.onProgress?.({
      phase: "optimizing",
      iteration: iter,
      maxIterations,
      similarity: bestFit,
      best: paramsFrom(initial, genome, bestVec),
    });
    await new Promise((r) => setTimeout(r, 0));
  }

  // --- Coordinate-descent polish on the best vector -------------------------
  opts.onProgress?.({
    phase: "polishing",
    iteration: maxIterations,
    maxIterations,
    similarity: bestFit,
    best: paramsFrom(initial, genome, bestVec),
  });
  for (let pass = 0; pass < 2; pass++) {
    if (opts.shouldStop?.()) break;
    for (let j = 0; j < dim; j++) {
      const g = genome[j];
      const span = g.max - g.min;
      for (const delta of [span * 0.08, -span * 0.08]) {
        const trial = bestVec.slice();
        trial[j] = Math.min(g.max, Math.max(g.min, trial[j] + delta));
        const fit = evaluate(paramsFrom(initial, genome, trial));
        if (fit > bestFit) {
          bestFit = fit;
          bestVec = trial;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 0));
  }

  const best = paramsFrom(initial, genome, bestVec);
  opts.onProgress?.({
    phase: "done",
    iteration: maxIterations,
    maxIterations,
    similarity: bestFit,
    best,
  });
  return best;
}
