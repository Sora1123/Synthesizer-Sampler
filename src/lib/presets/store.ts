/**
 * Preset system.
 *
 * Presets are just SynthParameters serialised to a generic JSON format. Stored
 * in localStorage for persistence and exportable/importable as .json files.
 * No proprietary synth preset format is used.
 */

import {
  cloneParameters,
  migrateParameters,
  type SynthParameters,
} from "../synth/params";

const STORAGE_KEY = "synth-param-finder.presets.v1";

export interface StoredPreset {
  id: string;
  savedAt: number;
  params: SynthParameters;
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function loadPresets(): StoredPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredPreset[];
  } catch {
    return [];
  }
}

function persist(presets: StoredPreset[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function savePreset(params: SynthParameters): StoredPreset[] {
  const presets = loadPresets();
  const preset: StoredPreset = {
    id: uid(),
    savedAt: Date.now(),
    params: cloneParameters(params),
  };
  presets.unshift(preset);
  persist(presets);
  return presets;
}

export function duplicatePreset(id: string): StoredPreset[] {
  const presets = loadPresets();
  const found = presets.find((p) => p.id === id);
  if (!found) return presets;
  const copy: StoredPreset = {
    id: uid(),
    savedAt: Date.now(),
    params: {
      ...cloneParameters(found.params),
      name: `${found.params.name} (copy)`,
    },
  };
  presets.unshift(copy);
  persist(presets);
  return presets;
}

export function deletePreset(id: string): StoredPreset[] {
  const presets = loadPresets().filter((p) => p.id !== id);
  persist(presets);
  return presets;
}

/** Serialize parameters to a downloadable JSON string. */
export function exportPresetJSON(params: SynthParameters): string {
  return JSON.stringify(params, null, 2);
}

/** Trigger a browser download of the preset JSON. */
export function downloadPreset(params: SynthParameters): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([exportPresetJSON(params)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = params.name.replace(/[^a-z0-9-_]+/gi, "_") || "preset";
  a.download = `${safe}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parse and validate an imported JSON preset. Accepts both the current (v2)
 * and legacy (v1) formats via migration. Throws if the JSON is unusable.
 */
export function importPresetJSON(text: string): SynthParameters {
  const obj = JSON.parse(text);
  if (typeof obj !== "object" || obj === null) {
    throw new Error("Invalid preset file: not a JSON object.");
  }
  if (typeof obj.fundamental !== "number") {
    throw new Error("Invalid preset file: missing fundamental frequency.");
  }
  return migrateParameters(obj);
}
