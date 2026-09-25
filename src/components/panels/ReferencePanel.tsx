"use client";

import React, { useRef } from "react";
import type { AudioAnalysis } from "@/lib/audio/analysis";
import { centsOff, freqToNoteName } from "@/lib/synth/dsp";
import { Button, Panel } from "../ui/controls";

export interface ReferenceState {
  fileName: string;
  samples: Float32Array;
  sampleRate: number;
  originalSampleRate: number;
  duration: number;
  channels: number;
  trimmedLeadingSeconds: number;
}

export function ReferencePanel({
  reference,
  analysis,
  onUpload,
  onPlay,
  onStop,
  isPlaying,
  onManualPitch,
}: {
  reference: ReferenceState | null;
  analysis: AudioAnalysis | null;
  onUpload: (file: File) => void;
  onPlay: () => void;
  onStop: () => void;
  isPlaying: boolean;
  onManualPitch: (freq: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Panel title="Reference Audio">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.flac"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="reference" onClick={() => inputRef.current?.click()}>
          Upload audio
        </Button>
        <Button
          onClick={isPlaying ? onStop : onPlay}
          disabled={!reference}
          variant="default"
        >
          {isPlaying ? "Stop" : "▶ Play reference"}
        </Button>
      </div>

      {reference ? (
        <div className="mt-3 space-y-1 text-xs">
          <Row label="File" value={reference.fileName} />
          <Row label="Duration" value={`${reference.duration.toFixed(3)} s`} />
          <Row
            label="Sample rate"
            value={`${reference.sampleRate} Hz (src ${reference.originalSampleRate})`}
          />
          <Row label="Channels" value={`${reference.channels} → mono`} />
          {reference.trimmedLeadingSeconds > 0.001 && (
            <Row
              label="Trimmed silence"
              value={`${(reference.trimmedLeadingSeconds * 1000).toFixed(0)} ms from start`}
            />
          )}
          {analysis && (
            <>
              <div className="my-2 border-t border-base-600" />
              <Row
                label="Detected pitch"
                value={`${freqToNoteName(analysis.fundamental)} (${centsOff(
                  analysis.fundamental,
                ) > 0 ? "+" : ""}${centsOff(analysis.fundamental)}¢)`}
                accent
              />
              <Row
                label="Fundamental"
                value={`${analysis.fundamental.toFixed(2)} Hz`}
                accent
              />
              <Row
                label="Confidence"
                value={`${(analysis.pitchConfidence * 100).toFixed(0)}%`}
              />
              <div className="mt-2 flex items-center gap-2">
                <span className="text-ink-muted">Override f₀</span>
                <input
                  type="number"
                  defaultValue={Math.round(analysis.fundamental * 100) / 100}
                  step={0.1}
                  className="w-24 rounded bg-base-700 px-2 py-1 text-ink outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = parseFloat(
                        (e.target as HTMLInputElement).value,
                      );
                      if (v > 0) onManualPitch(v);
                    }
                  }}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (v > 0) onManualPitch(v);
                  }}
                />
                <span className="text-ink-faint">Hz ⏎</span>
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-faint">
          Upload an isolated instrument note (WAV / MP3 / OGG / FLAC). It will be
          converted to mono, resampled to 44.1 kHz and normalized.
        </p>
      )}
    </Panel>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink-muted">{label}</span>
      <span
        className={`tabular-nums ${accent ? "text-accent" : "text-ink"} text-right`}
      >
        {value}
      </span>
    </div>
  );
}

export function AnalysisPanel({ analysis }: { analysis: AudioAnalysis | null }) {
  if (!analysis) {
    return (
      <Panel title="Analysis">
        <p className="text-xs text-ink-faint">
          Upload a reference sound to see its measured acoustic features.
        </p>
      </Panel>
    );
  }
  const e = analysis.envelope;
  return (
    <Panel title="Analysis">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Row
          label="Spectral centroid"
          value={`${analysis.spectralCentroid.toFixed(0)} Hz`}
        />
        <Row
          label="Bandwidth"
          value={`${analysis.spectralBandwidth.toFixed(0)} Hz`}
        />
        <Row
          label="Rolloff (85%)"
          value={`${analysis.spectralRolloff.toFixed(0)} Hz`}
        />
        <Row
          label="Zero-cross rate"
          value={`${analysis.zeroCrossingRate.toFixed(0)}/s`}
        />
        <Row
          label="Inharmonicity"
          value={`${(analysis.inharmonicity * 100).toFixed(2)}%`}
        />
        <Row label="RMS" value={analysis.rms.toFixed(3)} />
        <Row label="Noisiness" value={`${(analysis.noisiness * 100).toFixed(0)}%`} />
        <Row label="Spectral flux" value={`${(analysis.meanFlux * 100).toFixed(0)}%`} />
        <Row label="Attack" value={`${(e.attack * 1000).toFixed(0)} ms`} />
        <Row label="Decay" value={`${(e.decay * 1000).toFixed(0)} ms`} />
        <Row label="Sustain" value={e.sustainLevel.toFixed(2)} />
        <Row label="Release" value={`${(e.release * 1000).toFixed(0)} ms`} />
        <Row label="Harmonics found" value={`${analysis.harmonics.length}`} />
      </div>
      <div className="mt-3">
        <p className="panel-header mb-1">Reference harmonic spectrum</p>
        <div className="space-y-0.5">
          {analysis.harmonics.slice(0, 16).map((h) => (
            <div key={h.n} className="flex items-center gap-2 text-[10px]">
              <span className="w-6 text-ink-muted">H{h.n}</span>
              <span className="w-16 tabular-nums text-ink-faint">
                {h.freq.toFixed(0)}Hz
              </span>
              <div className="h-2 flex-1 rounded bg-base-700">
                <div
                  className="h-2 rounded bg-reference"
                  style={{ width: `${h.relative * 100}%` }}
                />
              </div>
              <span className="w-10 text-right tabular-nums text-ink">
                {(h.relative * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
