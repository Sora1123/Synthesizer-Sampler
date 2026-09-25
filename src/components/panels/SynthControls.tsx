"use client";

import React from "react";
import type {
  FilterType,
  NoiseColor,
  OscillatorWaveform,
  SynthParameters,
} from "@/lib/synth/params";
import {
  applyHarmonicPreset,
  HARMONIC_PRESETS,
  type HarmonicPresetId,
} from "@/lib/synth/presets";
import { freqToNoteName } from "@/lib/synth/dsp";
import {
  Button,
  ExpandableSection,
  NumberInput,
  Select,
  Slider,
  Toggle,
} from "../ui/controls";
import { HarmonicBars, HarmonicTable } from "../viz/HarmonicBars";
import { EnvelopeEditor } from "../viz/EnvelopeEditor";
import { FilterResponse } from "../viz/FilterResponse";

type Update = (mut: (p: SynthParameters) => void) => void;

const WAVEFORMS: { value: OscillatorWaveform; label: string }[] = [
  { value: "sine", label: "Sine" },
  { value: "triangle", label: "Triangle" },
  { value: "saw", label: "Saw" },
  { value: "square", label: "Square" },
  { value: "pulse", label: "Pulse" },
  { value: "custom", label: "Custom (partials)" },
];

// ---------------------------------------------------------------------------
// BASIC: pitch + mixer + amplitude envelope + brightness
// ---------------------------------------------------------------------------

export function BasicPanel({
  params,
  update,
  referenceEnvelope,
}: {
  params: SynthParameters;
  update: Update;
  referenceEnvelope?: Float32Array;
}) {
  return (
    <ExpandableSection title="Basic" tier="basic" defaultOpen>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput
          label={`Fundamental · ${freqToNoteName(params.fundamental)}`}
          value={Math.round(params.fundamental * 100) / 100}
          min={20}
          max={5000}
          step={0.01}
          suffix="Hz"
          onChange={(v) => update((p) => (p.fundamental = v))}
        />
        <NumberInput
          label="Duration"
          value={Math.round(params.duration * 1000) / 1000}
          min={0.1}
          max={10}
          step={0.05}
          suffix="s"
          onChange={(v) => update((p) => (p.duration = v))}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Slider label="Partials mix" value={params.mixer.partials} min={0} max={1} step={0.01} color="synth" onChange={(v) => update((p) => (p.mixer.partials = v))} />
        <Slider label="Master" value={params.mixer.master} min={0} max={1} step={0.01} color="synth" onChange={(v) => update((p) => (p.mixer.master = v))} />
      </div>
      <div className="mt-3">
        <p className="panel-header mb-1">Amplitude envelope</p>
        <EnvelopeEditor
          env={params.envelopes.amplitude}
          overlay={referenceEnvelope}
          onChange={(e) => update((p) => (p.envelopes.amplitude = e))}
        />
      </div>
    </ExpandableSection>
  );
}

// ---------------------------------------------------------------------------
// HARMONICS: graphical spectrum editor + table + presets + inharmonicity
// ---------------------------------------------------------------------------

export function HarmonicsPanel({
  params,
  update,
  referenceHarmonics,
}: {
  params: SynthParameters;
  update: Update;
  referenceHarmonics?: number[];
}) {
  const partials = params.partialBank.partials;
  const amps = partials.map((p) => p.amplitude);
  const [showTable, setShowTable] = React.useState(false);

  function setPreset(id: HarmonicPresetId) {
    update((p) => {
      const { partials: newPartials, inharmonicity } = applyHarmonicPreset(
        id,
        p.partialBank.partials.length,
      );
      // preserve any per-partial envelopes by only replacing amp/ratio/enabled
      p.partialBank.partials = p.partialBank.partials.map((old, i) => ({
        ...old,
        amplitude: newPartials[i]?.amplitude ?? 0,
        frequencyRatio: newPartials[i]?.frequencyRatio ?? i + 1,
        enabled: newPartials[i]?.enabled ?? false,
      }));
      if (inharmonicity != null) p.partialBank.inharmonicity = inharmonicity;
    });
  }

  return (
    <ExpandableSection
      title={`Harmonics / Partials (${partials.length})`}
      tier="advanced"
      defaultOpen
      right={
        <button
          className="rounded bg-base-600 px-2 py-0.5 text-[10px] text-ink hover:bg-base-500"
          onClick={() => setShowTable((s) => !s)}
        >
          {showTable ? "graph" : "table"}
        </button>
      }
    >
      {showTable ? (
        <HarmonicTable
          partials={partials}
          onAmplitude={(i, v) =>
            update((p) => {
              p.partialBank.partials[i].amplitude = v;
              p.partialBank.partials[i].enabled = v > 0.001;
            })
          }
          onRatio={(i, v) =>
            update((p) => (p.partialBank.partials[i].frequencyRatio = v))
          }
        />
      ) : (
        <HarmonicBars
          amplitudes={amps}
          reference={referenceHarmonics}
          onChange={(index, value) =>
            update((p) => {
              p.partialBank.partials[index].amplitude = value;
              p.partialBank.partials[index].enabled = value > 0.001;
            })
          }
        />
      )}
      {referenceHarmonics && (
        <p className="mt-1 text-[10px] text-ink-faint">
          <span className="text-synth">■</span> synth ·{" "}
          <span className="text-reference">┈</span> reference
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {HARMONIC_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            className="rounded bg-base-600 px-2 py-1 text-[10px] text-ink hover:bg-base-500"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Slider
          label="Bank level"
          value={params.partialBank.level}
          min={0}
          max={1}
          step={0.01}
          color="synth"
          onChange={(v) => update((p) => (p.partialBank.level = v))}
        />
        <Slider
          label="Inharmonicity (B)"
          value={params.partialBank.inharmonicity}
          min={0}
          max={0.006}
          step={0.0001}
          color="synth"
          format={(v) => `${(v * 1000).toFixed(2)}‰`}
          onChange={(v) => update((p) => (p.partialBank.inharmonicity = v))}
        />
      </div>
      <div className="mt-2 flex gap-1">
        <Button
          onClick={() =>
            update((p) => {
              const n = p.partialBank.partials.length;
              if (n < 128)
                p.partialBank.partials.push({
                  enabled: true,
                  frequencyRatio: n + 1,
                  frequencyOffset: 0,
                  amplitude: 0,
                  phase: 0,
                });
            })
          }
        >
          + Partial
        </Button>
        <Button
          onClick={() =>
            update((p) => {
              if (p.partialBank.partials.length > 1) p.partialBank.partials.pop();
            })
          }
        >
          − Partial
        </Button>
      </div>
    </ExpandableSection>
  );
}

// ---------------------------------------------------------------------------
// SPECTRAL ENVELOPE
// ---------------------------------------------------------------------------

export function SpectralEnvelopePanel({
  params,
  update,
}: {
  params: SynthParameters;
  update: Update;
}) {
  const se = params.spectralEnvelope;
  return (
    <ExpandableSection
      title="Spectral Envelope"
      tier="advanced"
      right={
        <Toggle
          label="on"
          checked={se.enabled}
          onChange={(v) => update((p) => (p.spectralEnvelope.enabled = v))}
        />
      }
    >
      <Slider
        label="Tilt (dB/oct)"
        value={se.tilt}
        min={-12}
        max={12}
        step={0.5}
        color="synth"
        format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
        onChange={(v) => update((p) => (p.spectralEnvelope.tilt = v))}
      />
      <div className="mt-2 space-y-1">
        <p className="panel-header">Band gains (dB)</p>
        {se.points.map((pt, i) => (
          <Slider
            key={i}
            label={pt.freq >= 1000 ? `${(pt.freq / 1000).toFixed(1)}k Hz` : `${pt.freq.toFixed(0)} Hz`}
            value={pt.gainDb}
            min={-24}
            max={24}
            step={0.5}
            color="synth"
            format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
            onChange={(v) => update((p) => (p.spectralEnvelope.points[i].gainDb = v))}
          />
        ))}
      </div>
      <div className="mt-2">
        <p className="panel-header mb-1">Resonance peaks</p>
        {se.peaks.map((peak, i) => (
          <div key={i} className="mb-1 grid grid-cols-3 gap-1">
            <NumberInput label="freq" value={Math.round(peak.freq)} min={20} max={20000} step={10} onChange={(v) => update((p) => (p.spectralEnvelope.peaks[i].freq = v))} />
            <NumberInput label="gain" value={Math.round(peak.gain * 100) / 100} min={0} max={8} step={0.1} onChange={(v) => update((p) => (p.spectralEnvelope.peaks[i].gain = v))} />
            <NumberInput label="bw" value={Math.round(peak.bandwidth)} min={10} max={5000} step={10} onChange={(v) => update((p) => (p.spectralEnvelope.peaks[i].bandwidth = v))} />
          </div>
        ))}
        <div className="flex gap-1">
          <Button onClick={() => update((p) => p.spectralEnvelope.peaks.push({ freq: 1000, gain: 2, bandwidth: 200 }))}>+ Peak</Button>
          <Button onClick={() => update((p) => { p.spectralEnvelope.peaks.pop(); })}>− Peak</Button>
        </div>
      </div>
    </ExpandableSection>
  );
}

// ---------------------------------------------------------------------------
// ENVELOPES (independent modulation envelopes)
// ---------------------------------------------------------------------------

export function EnvelopesPanel({
  params,
  update,
}: {
  params: SynthParameters;
  update: Update;
}) {
  const env = params.envelopes;
  return (
    <ExpandableSection title="Modulation Envelopes" tier="expert">
      <div className="space-y-3">
        <div>
          <p className="panel-header mb-1">Filter cutoff (0..1)</p>
          <EnvelopeEditor env={env.filter} onChange={(e) => update((p) => (p.envelopes.filter = e))} />
        </div>
        <div>
          <p className="panel-header mb-1">Pitch (semitones)</p>
          <EnvelopeEditor env={env.pitch} vMin={-12} vMax={12} onChange={(e) => update((p) => (p.envelopes.pitch = e))} />
        </div>
        <div>
          <p className="panel-header mb-1">Brightness (× tilt)</p>
          <EnvelopeEditor env={env.brightness} vMin={0} vMax={2} onChange={(e) => update((p) => (p.envelopes.brightness = e))} />
        </div>
        <div>
          <p className="panel-header mb-1">Noise amount (0..1)</p>
          <EnvelopeEditor env={env.noise} onChange={(e) => update((p) => (p.envelopes.noise = e))} />
        </div>
      </div>
    </ExpandableSection>
  );
}

// ---------------------------------------------------------------------------
// OSCILLATORS + SUB
// ---------------------------------------------------------------------------

export function OscillatorPanel({
  params,
  update,
}: {
  params: SynthParameters;
  update: Update;
}) {
  return (
    <ExpandableSection title="Oscillators + Sub" tier="advanced">
      <Slider label="Osc mix" value={params.mixer.osc} min={0} max={1} step={0.01} color="synth" onChange={(v) => update((p) => (p.mixer.osc = v))} />
      <div className="mt-2 space-y-2">
        {params.oscillators.map((osc, i) => (
          <div key={i} className="rounded border border-base-600 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">OSC {i + 1}</span>
              <Toggle label="on" checked={osc.enabled} onChange={(v) => update((p) => (p.oscillators[i].enabled = v))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select<OscillatorWaveform> label="Waveform" value={osc.waveform} options={WAVEFORMS} onChange={(v) => update((p) => (p.oscillators[i].waveform = v))} />
              <Slider label="Level" value={osc.level} min={0} max={1} step={0.01} color="synth" onChange={(v) => update((p) => (p.oscillators[i].level = v))} />
              <Slider label="Detune ¢" value={osc.detuneCents} min={-50} max={50} step={1} color="synth" onChange={(v) => update((p) => (p.oscillators[i].detuneCents = v))} />
              <Slider label="Octave" value={osc.octave} min={-2} max={2} step={1} color="synth" onChange={(v) => update((p) => (p.oscillators[i].octave = v))} />
              {osc.waveform === "pulse" && (
                <Slider label="Pulse width" value={osc.pulseWidth} min={0.05} max={0.95} step={0.01} color="synth" onChange={(v) => update((p) => (p.oscillators[i].pulseWidth = v))} />
              )}
            </div>
          </div>
        ))}
        <div className="rounded border border-base-600 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">SUB</span>
            <Toggle label="on" checked={params.sub.enabled} onChange={(v) => update((p) => (p.sub.enabled = v))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select<"sine" | "square" | "triangle"> label="Waveform" value={params.sub.waveform} options={[{ value: "sine", label: "Sine" }, { value: "square", label: "Square" }, { value: "triangle", label: "Triangle" }]} onChange={(v) => update((p) => (p.sub.waveform = v))} />
            <Slider label="Sub mix" value={params.mixer.sub} min={0} max={1} step={0.01} color="synth" onChange={(v) => update((p) => (p.mixer.sub = v))} />
          </div>
        </div>
      </div>
    </ExpandableSection>
  );
}

// ---------------------------------------------------------------------------
// FILTER
// ---------------------------------------------------------------------------

const FILTER_TYPES: { value: FilterType; label: string }[] = [
  { value: "lowpass", label: "Low-pass" },
  { value: "highpass", label: "High-pass" },
  { value: "bandpass", label: "Band-pass" },
  { value: "none", label: "Off" },
];

export function FilterPanel({
  params,
  update,
}: {
  params: SynthParameters;
  update: Update;
}) {
  return (
    <ExpandableSection title="Filter" tier="advanced">
      <div className="mb-2">
        <FilterResponse filter={{ type: params.filter.type, cutoff: params.filter.cutoff, resonance: params.filter.resonance, envAmount: params.filter.envAmount }} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select<FilterType> label="Type" value={params.filter.type} options={FILTER_TYPES} onChange={(v) => update((p) => (p.filter.type = v))} />
        <Slider label="Cutoff" value={params.filter.cutoff} min={20} max={20000} step={10} format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`)} onChange={(v) => update((p) => (p.filter.cutoff = v))} />
        <Slider label="Resonance" value={params.filter.resonance} min={0.1} max={12} step={0.1} onChange={(v) => update((p) => (p.filter.resonance = v))} />
        <Slider label="Env amount" value={params.filter.envAmount} min={-10000} max={10000} step={100} format={(v) => `${(v / 1000).toFixed(1)}k`} onChange={(v) => update((p) => (p.filter.envAmount = v))} />
      </div>
      <p className="mt-1 text-[9px] text-ink-faint">Filter env editor is in Modulation Envelopes (expert).</p>
    </ExpandableSection>
  );
}

// ---------------------------------------------------------------------------
// NOISE (with spectral shaping)
// ---------------------------------------------------------------------------

const NOISE_COLORS: { value: NoiseColor; label: string }[] = [
  { value: "white", label: "White" },
  { value: "pink", label: "Pink" },
  { value: "brown", label: "Brown" },
];

export function NoisePanel({
  params,
  update,
}: {
  params: SynthParameters;
  update: Update;
}) {
  return (
    <ExpandableSection
      title="Noise"
      tier="advanced"
      right={<Toggle label="on" checked={params.noise.enabled} onChange={(v) => update((p) => { p.noise.enabled = v; p.mixer.noise = v ? Math.max(0.2, p.mixer.noise) : 0; })} />}
    >
      <div className="grid grid-cols-2 gap-2">
        <Select<NoiseColor> label="Color" value={params.noise.color} options={NOISE_COLORS} onChange={(v) => update((p) => (p.noise.color = v))} />
        <Slider label="Mix" value={params.mixer.noise} min={0} max={1} step={0.01} onChange={(v) => update((p) => (p.mixer.noise = v))} />
        <Slider label="Level" value={params.noise.level} min={0} max={1} step={0.01} onChange={(v) => update((p) => (p.noise.level = v))} />
        <Slider label="Tilt (dB/oct)" value={params.noise.tilt} min={-12} max={12} step={0.5} onChange={(v) => update((p) => (p.noise.tilt = v))} />
        <Slider label="Low-pass" value={params.noise.lowpass} min={200} max={20000} step={100} format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`)} onChange={(v) => update((p) => (p.noise.lowpass = v))} />
        <Slider label="High-pass" value={params.noise.highpass} min={20} max={10000} step={20} format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`)} onChange={(v) => update((p) => (p.noise.highpass = v))} />
      </div>
      <p className="mt-1 text-[9px] text-ink-faint">Noise envelope is in Modulation Envelopes (expert).</p>
    </ExpandableSection>
  );
}

// ---------------------------------------------------------------------------
// TRANSIENT
// ---------------------------------------------------------------------------

export function TransientPanel({
  params,
  update,
}: {
  params: SynthParameters;
  update: Update;
}) {
  const tr = params.transient;
  return (
    <ExpandableSection
      title="Transient"
      tier="advanced"
      right={<Toggle label="on" checked={tr.enabled} onChange={(v) => update((p) => { p.transient.enabled = v; p.mixer.transient = v ? Math.max(0.3, p.mixer.transient) : 0; })} />}
    >
      <div className="grid grid-cols-2 gap-2">
        <Slider label="Mix" value={params.mixer.transient} min={0} max={1} step={0.01} onChange={(v) => update((p) => (p.mixer.transient = v))} />
        <Slider label="Level" value={tr.level} min={0} max={1} step={0.01} onChange={(v) => update((p) => (p.transient.level = v))} />
        <Slider label="Duration" value={tr.duration} min={0.002} max={0.2} step={0.001} format={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => update((p) => (p.transient.duration = v))} />
        <Slider label="Pitch decay" value={tr.pitchDecay} min={0} max={1} step={0.01} onChange={(v) => update((p) => (p.transient.pitchDecay = v))} />
        <Slider label="Brightness" value={tr.brightness} min={0} max={1} step={0.01} onChange={(v) => update((p) => (p.transient.brightness = v))} />
        <Slider label="Noise amt" value={tr.noiseAmount} min={0} max={1} step={0.01} onChange={(v) => update((p) => (p.transient.noiseAmount = v))} />
        <Slider label="Harmonic amt" value={tr.harmonicAmount} min={0} max={1} step={0.01} onChange={(v) => update((p) => (p.transient.harmonicAmount = v))} />
        <NumberInput label="Pitch (Hz, 0=auto)" value={Math.round(tr.pitch)} min={0} max={20000} step={10} onChange={(v) => update((p) => (p.transient.pitch = v))} />
        <NumberInput label="Freq low" value={Math.round(tr.freqLow)} min={20} max={20000} step={10} onChange={(v) => update((p) => (p.transient.freqLow = v))} />
        <NumberInput label="Freq high" value={Math.round(tr.freqHigh)} min={20} max={20000} step={10} onChange={(v) => update((p) => (p.transient.freqHigh = v))} />
      </div>
    </ExpandableSection>
  );
}
