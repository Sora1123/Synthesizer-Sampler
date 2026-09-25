/**
 * Harmonic presets. These generate *actual* harmonic amplitude arrays — they
 * never play back samples. Each returns amplitudes for `count` harmonics
 * (index 0 == fundamental).
 */

import type { Partial } from "./params";

export type HarmonicPresetId =
  | "fundamental"
  | "saw"
  | "square"
  | "triangle"
  | "bright"
  | "dark"
  | "bell"
  | "piano"
  | "organ";

export interface HarmonicPreset {
  id: HarmonicPresetId;
  label: string;
  /** returns amplitudes 0..1 for each harmonic index (0-based) */
  amplitudes: (count: number) => number[];
  /** suggested inharmonicity coefficient B (optional) */
  inharmonicity?: number;
}

function normalize(arr: number[]): number[] {
  const max = Math.max(...arr, 1e-9);
  return arr.map((a) => a / max);
}

export const HARMONIC_PRESETS: HarmonicPreset[] = [
  {
    id: "fundamental",
    label: "Fundamental only",
    amplitudes: (count) => Array.from({ length: count }, (_, i) => (i === 0 ? 1 : 0)),
  },
  {
    id: "saw",
    label: "Saw-like",
    // Saw: amplitude ~ 1/n for all harmonics.
    amplitudes: (count) =>
      normalize(Array.from({ length: count }, (_, i) => 1 / (i + 1))),
  },
  {
    id: "square",
    label: "Square-like",
    // Square: odd harmonics only, amplitude ~ 1/n.
    amplitudes: (count) =>
      normalize(
        Array.from({ length: count }, (_, i) => {
          const n = i + 1;
          return n % 2 === 1 ? 1 / n : 0;
        }),
      ),
  },
  {
    id: "triangle",
    label: "Triangle-like",
    // Triangle: odd harmonics, amplitude ~ 1/n^2, alternating sign folded to mag.
    amplitudes: (count) =>
      normalize(
        Array.from({ length: count }, (_, i) => {
          const n = i + 1;
          return n % 2 === 1 ? 1 / (n * n) : 0;
        }),
      ),
  },
  {
    id: "bright",
    label: "Bright",
    // Slow rolloff -> lots of upper energy.
    amplitudes: (count) =>
      normalize(Array.from({ length: count }, (_, i) => 1 / Math.sqrt(i + 1))),
  },
  {
    id: "dark",
    label: "Dark",
    // Fast rolloff -> mostly fundamental + low partials.
    amplitudes: (count) =>
      normalize(Array.from({ length: count }, (_, i) => 1 / Math.pow(i + 1, 2.5))),
  },
  {
    id: "bell",
    label: "Bell",
    // Sparse, inharmonic-leaning partials with strong upper resonances.
    amplitudes: (count) =>
      normalize(
        Array.from({ length: count }, (_, i) => {
          const n = i + 1;
          // Emphasize a few partials typical of struck metal.
          const emphasis = [1, 0.6, 0.0, 0.9, 0.0, 0.5, 0.0, 0.4];
          const base = emphasis[i] ?? 0.7 / n;
          return base;
        }),
      ),
    inharmonicity: 0.001,
  },
  {
    id: "piano",
    label: "Piano-like",
    // Strong fundamental, gradually decaying upper harmonics, slight stretch.
    amplitudes: (count) =>
      normalize(
        Array.from({ length: count }, (_, i) => {
          const n = i + 1;
          return Math.pow(0.72, i) * (1 + 0.15 * Math.sin(n)); // gentle ripple
        }),
      ),
    inharmonicity: 0.0004,
  },
  {
    id: "organ",
    label: "Organ-like",
    // Drawbar-style: strong fundamental + octaves + fifth.
    amplitudes: (count) =>
      normalize(
        Array.from({ length: count }, (_, i) => {
          const n = i + 1;
          if (n === 1) return 1;
          if (n === 2) return 0.8;
          if (n === 3) return 0.6;
          if (n === 4) return 0.5;
          if (n === 6) return 0.3;
          if (n === 8) return 0.25;
          return 0.05;
        }),
      ),
  },
];

export function applyHarmonicPreset(
  id: HarmonicPresetId,
  count: number,
): { partials: Partial[]; inharmonicity?: number } {
  const preset = HARMONIC_PRESETS.find((p) => p.id === id);
  if (!preset) {
    return { partials: [] };
  }
  const amps = preset.amplitudes(count);
  return {
    partials: amps.map((a, i) => ({
      enabled: a > 0.0001,
      frequencyRatio: i + 1,
      frequencyOffset: 0,
      amplitude: a,
      phase: 0,
    })),
    inharmonicity: preset.inharmonicity,
  };
}
