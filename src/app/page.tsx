"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cloneParameters,
  defaultParameters,
  type SynthParameters,
} from "@/lib/synth/params";
import { renderSynth, renderSingleCycle } from "@/lib/synth/engine";
import { decodeAudioFile, downloadWav, playSamples, stopPlayback } from "@/lib/audio/playback";
import { analyzeAudio, type AudioAnalysis } from "@/lib/audio/analysis";
import {
  compareSignals,
  DEFAULT_WEIGHTS,
  measureHarmonicRelatives,
  type LossWeights,
  type SimilarityBreakdown,
} from "@/lib/audio/compare";
import { defaultPredictor } from "@/lib/audio/predictor";
import { autoMatch, type OptimizeProgress } from "@/lib/audio/optimizer";
import {
  deletePreset,
  downloadPreset,
  duplicatePreset,
  importPresetJSON,
  loadPresets,
  savePreset,
  type StoredPreset,
} from "@/lib/presets/store";

import { Button } from "@/components/ui/controls";
import { WaveformView } from "@/components/viz/WaveformView";
import { SpectrumView } from "@/components/viz/SpectrumView";
import { CycleView } from "@/components/viz/CycleView";
import {
  BasicPanel,
  EnvelopesPanel,
  FilterPanel,
  HarmonicsPanel,
  NoisePanel,
  OscillatorPanel,
  SpectralEnvelopePanel,
  TransientPanel,
} from "@/components/panels/SynthControls";
import {
  AnalysisPanel,
  ReferencePanel,
  type ReferenceState,
} from "@/components/panels/ReferencePanel";
import { ComparisonPanel } from "@/components/panels/ComparisonPanel";
import { AutoMatchPanel, PresetPanel } from "@/components/panels/AutoMatchPanel";

const REF_COLOR = "#4cc9f0";
const SYNTH_COLOR = "#f6a13a";
const SAMPLE_RATE = 44100;

export default function LabPage() {
  const [params, setParams] = useState<SynthParameters>(() => defaultParameters());
  const [reference, setReference] = useState<ReferenceState | null>(null);
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [similarity, setSimilarity] = useState<SimilarityBreakdown | null>(null);
  const [weights, setWeights] = useState<LossWeights>(DEFAULT_WEIGHTS);
  const [playing, setPlaying] = useState<"none" | "ref" | "synth">("none");
  const [presets, setPresets] = useState<StoredPreset[]>([]);
  const [progress, setProgress] = useState<OptimizeProgress | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  useEffect(() => setPresets(loadPresets()), []);

  const [synth, setSynth] = useState<{ samples: Float32Array; sampleRate: number } | null>(null);
  const [cycle, setCycle] = useState<Float32Array>(() => renderSingleCycle(defaultParameters()));

  // Re-render synth (debounced) whenever params change.
  useEffect(() => {
    const handle = setTimeout(() => {
      const result = renderSynth(params, { sampleRate: SAMPLE_RATE });
      setSynth({ samples: result.samples, sampleRate: result.sampleRate });
      setCycle(renderSingleCycle(params));
    }, 80);
    return () => clearTimeout(handle);
  }, [params]);

  // Recompute similarity when reference/synth/weights change.
  useEffect(() => {
    if (!reference || !synth || !analysis) {
      setSimilarity(null);
      return;
    }
    const handle = setTimeout(() => {
      const refRel = measureHarmonicRelatives(reference.samples, SAMPLE_RATE, analysis.fundamental, 32);
      const synthRel = measureHarmonicRelatives(synth.samples, SAMPLE_RATE, params.fundamental, 32);
      const sim = compareSignals(reference.samples, synth.samples, SAMPLE_RATE, {
        refHarmonics: refRel,
        synthHarmonics: synthRel,
        weights,
      });
      setSimilarity(sim);
    }, 120);
    return () => clearTimeout(handle);
  }, [reference, synth, analysis, params, weights]);

  const update = useCallback((mut: (p: SynthParameters) => void) => {
    setParams((prev) => {
      const next = cloneParameters(prev);
      mut(next);
      return next;
    });
  }, []);

  async function handleUpload(file: File) {
    setError(null);
    try {
      const decoded = await decodeAudioFile(file, SAMPLE_RATE);
      const ref: ReferenceState = {
        fileName: file.name,
        samples: decoded.samples,
        sampleRate: decoded.sampleRate,
        originalSampleRate: decoded.originalSampleRate,
        duration: decoded.duration,
        channels: decoded.channels,
        trimmedLeadingSeconds: decoded.trimmedLeadingSeconds,
      };
      setReference(ref);
      const a = analyzeAudio(decoded.samples, decoded.sampleRate);
      setAnalysis(a);
    } catch (err) {
      setError(
        `Could not decode "${file.name}". The browser may not support this format. ${(err as Error).message}`,
      );
    }
  }

  async function playRef() {
    if (!reference) return;
    setPlaying("ref");
    await playSamples(reference.samples, reference.sampleRate);
    setPlaying("none");
  }
  async function playSynth() {
    if (!synth) return;
    setPlaying("synth");
    await playSamples(synth.samples, synth.sampleRate);
    setPlaying("none");
  }
  function stopAll() {
    stopPlayback();
    setPlaying("none");
  }

  function applyAnalysisToSynth() {
    if (!analysis) return;
    setParams(defaultPredictor.predict(analysis));
  }

  async function runAutoMatch() {
    if (!reference || !analysis) return;
    setOptimizing(true);
    stopRef.current = false;
    try {
      const best = await autoMatch(reference.samples, analysis, {
        maxIterations: 45,
        sampleRate: 22050,
        optimizePartials: 32,
        weights,
        onProgress: (p) => setProgress(p),
        shouldStop: () => stopRef.current,
      });
      setParams(best);
    } catch (err) {
      setError(`Auto Match failed: ${(err as Error).message}`);
    } finally {
      setOptimizing(false);
    }
  }
  function stopAutoMatch() {
    stopRef.current = true;
  }

  function handleSavePreset() {
    setPresets(savePreset(params));
  }
  function handleReset() {
    setParams(defaultParameters());
  }
  function handleExport() {
    downloadPreset(params);
  }
  async function handleImport(file: File) {
    try {
      const text = await file.text();
      setParams(importPresetJSON(text));
    } catch (err) {
      setError(`Import failed: ${(err as Error).message}`);
    }
  }

  const referenceHarmonics = useMemo(
    () => analysis?.harmonics.map((h) => h.relative),
    [analysis],
  );

  const waveformTraces = useMemo(() => {
    const traces = [];
    if (reference)
      traces.push({ samples: reference.samples, sampleRate: reference.sampleRate, color: REF_COLOR, label: "Reference" });
    if (synth)
      traces.push({ samples: synth.samples, sampleRate: synth.sampleRate, color: SYNTH_COLOR, label: "Synthesis" });
    return traces;
  }, [reference, synth]);

  return (
    <main className="min-h-screen bg-base-900 p-3 text-ink">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-ink">
          Synth Param Finder
          <span className="ml-2 text-xs font-normal text-ink-faint">
            high-dimensional sound-reconstruction laboratory
          </span>
        </h1>
        <div className="flex gap-2">
          <Button variant="reference" onClick={playing === "ref" ? stopAll : playRef} disabled={!reference}>
            {playing === "ref" ? "■ Stop" : "▶ A: Reference"}
          </Button>
          <Button variant="synth" onClick={playing === "synth" ? stopAll : playSynth} disabled={!synth}>
            {playing === "synth" ? "■ Stop" : "▶ B: Synthesis"}
          </Button>
          <Button
            variant="default"
            onClick={() => {
              if (synth) downloadWav(synth.samples, synth.sampleRate, `${params.name || "synthesis"}.wav`);
            }}
            disabled={!synth}
            title="Download the synthesized audio as a 16-bit WAV file"
          >
            ⬇ Download WAV
          </Button>
        </div>
      </header>

      {error && (
        <div className="mb-3 rounded border border-danger/50 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* LEFT: reference + auto match + presets */}
        <div className="space-y-3 lg:col-span-3">
          <ReferencePanel
            reference={reference}
            analysis={analysis}
            onUpload={handleUpload}
            onPlay={playRef}
            onStop={stopAll}
            isPlaying={playing === "ref"}
            onManualPitch={(f) => {
              setAnalysis((a) => (a ? { ...a, fundamental: f } : a));
              update((p) => (p.fundamental = f));
            }}
          />
          <AutoMatchPanel
            canRun={!!reference && !!analysis}
            running={optimizing}
            progress={progress}
            onRun={runAutoMatch}
            onStop={stopAutoMatch}
            onApplyAnalysis={applyAnalysisToSynth}
          />
          <PresetPanel
            presets={presets}
            onSave={handleSavePreset}
            onLoad={(p) => setParams(p)}
            onDuplicate={(id) => setPresets(duplicatePreset(id))}
            onDelete={(id) => setPresets(deletePreset(id))}
            onReset={handleReset}
            onExport={handleExport}
            onImport={handleImport}
          />
          <AnalysisPanel analysis={analysis} />
        </div>

        {/* CENTER: visualizations */}
        <div className="space-y-3 lg:col-span-5">
          <section className="panel p-3">
            <h2 className="panel-header mb-2">Waveform (Reference vs Synthesis)</h2>
            {waveformTraces.length > 0 ? (
              <WaveformView traces={waveformTraces} />
            ) : (
              <p className="text-xs text-ink-faint">Upload a reference or adjust the synth.</p>
            )}
          </section>
          <section className="panel p-3">
            <h2 className="panel-header mb-2">Frequency Spectrum</h2>
            {waveformTraces.length > 0 ? (
              <SpectrumView traces={waveformTraces} fundamental={analysis?.fundamental ?? params.fundamental} />
            ) : (
              <p className="text-xs text-ink-faint">No signal yet.</p>
            )}
          </section>
          <section className="panel p-3">
            <CycleView cycle={cycle} />
          </section>
          <ComparisonPanel similarity={similarity} weights={weights} onWeights={setWeights} />
        </div>

        {/* RIGHT: tiered synth controls */}
        <div className="space-y-2 lg:col-span-4">
          <Button variant="default" disabled={!analysis} onClick={applyAnalysisToSynth} className="w-full">
            Apply Analysis → Synth (high-dimensional init)
          </Button>
          <BasicPanel params={params} update={update} referenceEnvelope={analysis?.envelope.curve} />
          <HarmonicsPanel params={params} update={update} referenceHarmonics={referenceHarmonics} />
          <SpectralEnvelopePanel params={params} update={update} />
          <OscillatorPanel params={params} update={update} />
          <FilterPanel params={params} update={update} />
          <TransientPanel params={params} update={update} />
          <NoisePanel params={params} update={update} />
          <EnvelopesPanel params={params} update={update} />
        </div>
      </div>

      <footer className="mt-4 text-center text-[10px] text-ink-faint">
        Time-varying additive resynthesis (up to 128 partials) · per-partial
        amplitude envelopes · spectral envelope · multi-resolution STFT loss ·
        differential-evolution Auto Match. Reference audio is onset-trimmed and
        normalized so it aligns with the synth. Similarity is an experimental
        metric, not a perceptual guarantee.
      </footer>
    </main>
  );
}
