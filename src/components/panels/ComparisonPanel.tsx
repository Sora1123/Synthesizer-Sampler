"use client";

import React from "react";
import type { SimilarityBreakdown, LossWeights } from "@/lib/audio/compare";
import { ExpandableSection, Slider } from "../ui/controls";

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const hue = 120 * value;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-ink-muted">{label}</span>
      <div className="h-3 flex-1 rounded bg-base-700">
        <div className="h-3 rounded transition-[width]" style={{ width: `${pct}%`, background: `hsl(${hue} 70% 55%)` }} />
      </div>
      <span className="w-10 text-right tabular-nums text-ink">{pct}%</span>
    </div>
  );
}

export function ComparisonPanel({
  similarity,
  weights,
  onWeights,
}: {
  similarity: SimilarityBreakdown | null;
  weights: LossWeights;
  onWeights: (w: LossWeights) => void;
}) {
  return (
    <section className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="panel-header">Similarity (experimental loss)</h2>
      </div>
      {!similarity ? (
        <p className="text-xs text-ink-faint">
          Upload a reference and render the synth to compute the loss breakdown.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-accent">
              {Math.round(similarity.overall * 100)}%
            </span>
            <span className="text-xs text-ink-muted">overall (1 − weighted loss)</span>
          </div>
          <Bar label="Waveform" value={similarity.waveform} />
          <Bar label="Multi-STFT" value={similarity.stft} />
          <Bar label="Harmonic" value={similarity.harmonic} />
          <Bar label="Spectral env" value={similarity.spectral} />
          <Bar label="Amp envelope" value={similarity.envelope} />
          <Bar label="Transient" value={similarity.transient} />
          <Bar label="Centroid" value={similarity.centroid} />

          <div className="pt-2">
            <ExpandableSection title="Loss weights" tier="expert">
              <div className="space-y-1">
                <WeightSlider label="waveform" value={weights.waveform} onChange={(v) => onWeights({ ...weights, waveform: v })} />
                <WeightSlider label="multi-STFT" value={weights.stft} onChange={(v) => onWeights({ ...weights, stft: v })} />
                <WeightSlider label="harmonic" value={weights.harmonic} onChange={(v) => onWeights({ ...weights, harmonic: v })} />
                <WeightSlider label="spectral" value={weights.spectral} onChange={(v) => onWeights({ ...weights, spectral: v })} />
                <WeightSlider label="envelope" value={weights.envelope} onChange={(v) => onWeights({ ...weights, envelope: v })} />
                <WeightSlider label="transient" value={weights.transient} onChange={(v) => onWeights({ ...weights, transient: v })} />
              </div>
            </ExpandableSection>
          </div>

          <p className="pt-1 text-[10px] leading-relaxed text-ink-faint">
            Objective signal-distance blend: waveform correlation, multi-resolution
            (512/1024/2048/4096) log-STFT distance, harmonic-vector cosine,
            spectral-envelope dB distance, amplitude-envelope and transient-onset
            distance. It is a useful optimization target but does not perfectly
            represent human perceptual similarity.
          </p>
        </div>
      )}
    </section>
  );
}

function WeightSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return <Slider label={label} value={value} min={0} max={1} step={0.01} onChange={onChange} />;
}
