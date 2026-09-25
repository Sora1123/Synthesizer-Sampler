"use client";

import React, { useRef } from "react";
import type { OptimizeProgress } from "@/lib/audio/optimizer";
import type { SynthParameters } from "@/lib/synth/params";
import type { StoredPreset } from "@/lib/presets/store";
import { Button, Panel } from "../ui/controls";

export function AutoMatchPanel({
  canRun,
  running,
  progress,
  onRun,
  onStop,
  onApplyAnalysis,
}: {
  canRun: boolean;
  running: boolean;
  progress: OptimizeProgress | null;
  onRun: () => void;
  onStop: () => void;
  onApplyAnalysis: () => void;
}) {
  return (
    <Panel title="Auto Match">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!canRun || running}
          onClick={onRun}
          className="text-sm"
        >
          ⚡ AUTO MATCH
        </Button>
        {running && (
          <Button variant="danger" onClick={onStop}>
            Stop
          </Button>
        )}
        <Button variant="default" disabled={!canRun} onClick={onApplyAnalysis}>
          Apply analysis → synth
        </Button>
      </div>
      {progress && (
        <div className="mt-3 text-xs">
          <div className="mb-1 flex justify-between">
            <span className="capitalize text-ink-muted">{progress.phase}</span>
            <span className="tabular-nums text-ink">
              {progress.iteration}/{progress.maxIterations}
            </span>
          </div>
          <div className="h-2 w-full rounded bg-base-700">
            <div
              className="h-2 rounded bg-accent transition-[width]"
              style={{
                width: `${
                  (progress.iteration / Math.max(1, progress.maxIterations)) *
                  100
                }%`,
              }}
            />
          </div>
          <div className="mt-1 text-ink-muted">
            Similarity:{" "}
            <span className="text-accent">
              {(progress.similarity * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      )}
      {!canRun && (
        <p className="mt-2 text-[10px] text-ink-faint">
          Upload a reference sound to enable Auto Match.
        </p>
      )}
    </Panel>
  );
}

export function PresetPanel({
  presets,
  onSave,
  onLoad,
  onDuplicate,
  onDelete,
  onReset,
  onExport,
  onImport,
}: {
  presets: StoredPreset[];
  onSave: () => void;
  onLoad: (params: SynthParameters) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Panel title="Presets">
      <div className="flex flex-wrap gap-1">
        <Button onClick={onSave}>Save</Button>
        <Button onClick={onReset}>Reset</Button>
        <Button onClick={onExport}>Export JSON</Button>
        <Button onClick={() => fileRef.current?.click()}>Import JSON</Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.currentTarget.value = "";
          }}
        />
      </div>
      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {presets.length === 0 ? (
          <p className="text-[10px] text-ink-faint">No saved presets yet.</p>
        ) : (
          presets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center gap-1 rounded bg-base-700 px-2 py-1 text-[10px]"
            >
              <button
                className="flex-1 truncate text-left text-ink hover:text-accent"
                onClick={() => onLoad(preset.params)}
                title="Load"
              >
                {preset.params.name}
              </button>
              <button
                className="text-ink-muted hover:text-accent"
                onClick={() => onDuplicate(preset.id)}
                title="Duplicate"
              >
                ⧉
              </button>
              <button
                className="text-ink-muted hover:text-danger"
                onClick={() => onDelete(preset.id)}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
