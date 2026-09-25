# Synth Param Finder — Sound-Replication Laboratory

A web-based **synthesizer sound-replication laboratory**. Upload an isolated
instrument note, analyze it, visualize its waveform / spectrum / harmonics /
envelope, then experiment with a generic synthesis engine to **reproduce the
acoustic character** of the reference — manually or with an automatic
parameter-search ("Auto Match").

This is a *scientific sound-design tool*, not a DAW and not a clone of Vital,
Serum, or any commercial synth. It has its own generic synthesis engine and its
own JSON parameter representation.

> **Important:** The system produces an **approximation** of the reference
> sound. It does **not** recover the original physical instrument, the exact
> synth that made the sound, or "the" correct settings. Many parameter sets can
> produce a similar spectrum. The similarity score is an *experimental,
> objective signal-distance metric* — not a model of human perception.

The first version targets **monophonic, isolated notes** (e.g. `piano_C4.wav`,
`violin_A4.wav`, `synth_bass.wav`). It does not attempt full-song synthesis.

---

## What it does

Workflow:

1. **Upload** an audio file (WAV / MP3 / OGG / FLAC — whatever your browser can
   decode). It is converted to **mono, 44.1 kHz, peak-normalized**, and its
   **leading (and trailing) silence is trimmed** so the reference onset aligns
   with the synthesizer (which always starts at t=0). Without this the two
   waveforms and their STFT frames would be offset and comparison would be
   meaningless.
2. **Analyze** the sound in detail: fundamental (YIN), **time-varying** harmonic
   amplitudes (STFT frame tracking), per-partial frequencies / inharmonicity,
   spectral envelope, spectral flux, noisiness, and amplitude envelope.
3. **Visualize** the reference: waveform, FFT spectrum (log frequency axis with
   hover peak readout + harmonic guides), an editable harmonic-spectrum graph,
   amplitude/breakpoint envelopes, and a generated single-cycle waveform.
4. **Synthesize** with a high-dimensional engine: a **time-varying additive
   partial bank** (default 64 partials, architecture supports 128+) where each
   partial has its own amplitude envelope and frequency ratio/offset, plus a
   spectral envelope, basic oscillators + sub, independent modulation envelopes,
   filter, spectrally-shaped noise, and a dedicated transient generator.
5. **Compare** reference vs. synthesized audio; overlay their waveforms and
   spectra; compute a transparent, **configurable multi-component loss**.
6. **A/B playback** of reference and synthesis.
7. **Auto Match**: analyze → predict a high-dimensional initial patch → render →
   compute loss → optimize (differential evolution + coordinate-descent polish)
   → return the best parameters. Shows progress and can be stopped.
8. **Presets**: save / load / duplicate / reset / export JSON / import JSON
   (old v1 presets are auto-migrated).

---

## Tech stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript** + **Tailwind CSS**
- **Web Audio API** for playback and file decoding
- A **dependency-free DSP core** (FFT, filters, envelopes, synthesis) written in
  plain TypeScript so it runs identically in the main thread, a Web Worker, or
  an optimization loop.

No Python backend is required: pitch detection (YIN), FFT/STFT analysis,
similarity, and the optimizer all run browser-side in TypeScript. The
architecture leaves room to move heavy ML work to a backend later (see
[Future AI architecture](#future-ai-architecture)).

---

## Architecture

```
src/
├── app/
│   ├── layout.tsx           # root layout + dark theme
│   ├── page.tsx             # LabPage: wires all state + panels together
│   └── globals.css
├── components/
│   ├── ui/controls.tsx      # Panel, ExpandableSection (basic/advanced/expert),
│   │                        #   Slider, Select, Toggle, Button, NumberInput
│   ├── viz/
│   │   ├── WaveformView.tsx     # amplitude/time, zoom, ref+synth overlay
│   │   ├── SpectrumView.tsx     # log-freq FFT, hover peaks, harmonic guides
│   │   ├── HarmonicBars.tsx     # paintable many-partial spectrum + table view
│   │   ├── EnvelopeEditor.tsx   # draggable arbitrary-breakpoint envelope editor
│   │   ├── EnvelopeGraph.tsx    # ADSR shape + measured-envelope overlay
│   │   ├── CycleView.tsx        # generated single-cycle waveform
│   │   └── FilterResponse.tsx   # biquad magnitude response curve
│   └── panels/
│       ├── SynthControls.tsx    # Basic/Harmonics/SpectralEnvelope/Envelopes/
│       │                        #   Oscillators/Filter/Transient/Noise (tiered)
│       ├── ReferencePanel.tsx   # upload/play/pitch-override + AnalysisPanel
│       ├── ComparisonPanel.tsx  # loss breakdown + configurable weights
│       └── AutoMatchPanel.tsx   # Auto Match + PresetPanel
└── lib/                     # React-independent core (pure functions)
    ├── synth/
    │   ├── params.ts        # SynthParameters v2 (partials, spectral env,
    │   │                    #   mod envelopes, mixer) + v1 migration
    │   ├── dsp.ts           # envelopes, noise, biquad, onset trim, math
    │   ├── engine.ts        # renderSynth(): time-varying additive renderer
    │   └── presets.ts       # harmonic presets (compute real partial amplitudes)
    ├── dsp/fft.ts           # radix-2 FFT + spectrum helpers
    ├── audio/
    │   ├── playback.ts      # AudioContext playback + file decode/resample
    │   ├── analysis.ts      # YIN pitch, harmonics, features, envelope
    │   ├── compare.ts       # multi-metric similarity
    │   ├── predictor.ts     # ParameterPredictor interface + heuristic impl
    │   └── optimizer.ts     # autoMatch(): differential evolution
    └── presets/store.ts     # localStorage + JSON import/export
```

The synthesis engine (`lib/synth/engine.ts`) is **deterministic**: given the
same `SynthParameters` and sample rate, it always renders identical audio
(noise uses a seeded PRNG). This is what makes optimization reproducible.

### Signal flow

```
Oscillators ─┐
HarmonicBank ─┼─> Mixer ─> Amplitude Envelope ─> Filter ─> Master gain ─> out
Noise ───────┤
Transient ───┘
```

(The `HarmonicBank` here is the time-varying additive **partial bank**.)

---

## Synthesis model

### Time-varying additive synthesis (the core)

The tonal core is a **high-resolution, time-varying additive partial bank**
(default 64 partials, architecture supports 128+). This is the key to
reproducing complex sounds: each partial has its **own amplitude trajectory over
time**, so the timbre can *evolve* across the note (bright attack → darker
decay) instead of being a spectrally-static waveform.

```
x(t) = Σ_n  A_n(t) · g_spec(f_n) · sin( 2π · f_n(t) · t + φ_n )
```

- `A_n(t)` — per-partial amplitude **breakpoint envelope** (arbitrary control
  points), so partial *n* can rise and fall independently of the others
- `f_n(t)` — `f0 · ratio_n · stretch(n) · freqEnv_n(t)` plus a global pitch
  envelope; each partial has its own `frequencyRatio` and `frequencyOffset`
- `g_spec(f)` — the spectral-envelope (formant/resonance) gain at that frequency
- `φ_n` — per-partial phase

Because each partial is an independent oscillator with its own frequency and
time-varying gain, the generated waveform can acquire **far more structure than
a sine / saw / triangle / square** — it is limited only by the number of
partials and their envelopes.

### Inharmonicity

Partials need not be exact integer multiples of `f0`. Two mechanisms cooperate:

- **Per-partial frequency ratio/offset** — set any partial to e.g. `2.013·f0`
  (edit in the Harmonics table). Analysis measures these ratios directly.
- **Global stiff-string coefficient `B`** — `f_n = n · f0 · sqrt(1 + B · n²)`,
  the classic model for piano/bell tone. `B = 0` gives exact harmonics.

Inharmonicity is **estimated automatically** from how far measured partials
drift from `n·f0` (magnitude-weighted least squares).

### Spectral envelope

A higher-level shaping stage applied to the partial amplitudes as a function of
frequency: a **tilt** (dB/octave), a set of **(frequency, gain-dB) control
points**, and **resonance/formant peaks** (center, gain, bandwidth). A
brightness modulation envelope scales the tilt over time.

### Layers + mixer

Independent, individually-mixed layers: the additive **partial bank**, two basic
**oscillators** (sine/triangle/saw/square/pulse/custom, with octave, detune,
pulse width), a **sub oscillator**, a spectrally-shaped **noise** layer, and a
dedicated **transient** generator. A `Mixer` sets each layer's gain plus master.

### Oscillators

Two oscillators — waveform (`sine`, `triangle`, `saw`, `square`, `pulse`, or
`custom` = the partial bank), level, detune (cents), octave, pulse width, phase,
optional hard sync — plus a sub oscillator (sine/square/triangle) below the
fundamental. The `custom` waveform is generated from the partial representation,
never a fixed sample.

### Envelopes

The amplitude path uses an **arbitrary-breakpoint envelope** (drag points to add
/ move / remove), not just ADSR — though an ADSR shape generator is available.
There are **independent modulation envelopes** for amplitude, filter cutoff,
pitch (semitones), harmonic brightness, and noise amount, so these are not
forced to share one ADSR. Per-partial amplitude envelopes drive the evolving
timbre described above.

### Filter

Low-pass / high-pass / band-pass biquad (RBJ cookbook coefficients) with cutoff,
resonance (Q), and a dedicated filter envelope that modulates the cutoff. A live
magnitude-response curve is drawn.

### Noise

White / pink / brown noise with its own level, one-pole low-pass cutoff, and
ADSR. Useful for breath (flute), bow noise (violin), hammer/pluck noise, and
percussion.

### Transient

A short burst at note onset (tonal click + filtered noise, exponentially
decaying) with controls for level, duration, brightness, noise amount, and
pitch offset. This is what makes struck/plucked attacks (piano hammer, guitar
pluck, mallet) sound believable versus a steady tone.

### Instruments as parameter configurations (not samples)

Acoustic-instrument character is expressed **entirely through parameters**,
never prerecorded samples:

| Instrument | Characteristic parameterization |
|------------|--------------------------------|
| Piano      | strong fundamental, decaying upper harmonics, small inharmonicity `B`, fast transient, long release |
| Flute      | few harmonics, strong fundamental, pink breath noise |
| Violin     | rich upper harmonics, slower attack, bow noise |
| Bell       | sparse strongly-inharmonic partials (`B` large), long release |
| Guitar     | harmonic-rich, sharp transient, moderately fast decay |
| Percussion | noise-dominant, very fast transient, minimal sustain |

The Harmonics panel ships presets (Fundamental only, Saw-like, Square-like,
Triangle-like, Bright, Dark, Bell, Piano-like, Organ-like). Each preset computes
**actual harmonic amplitudes** — no audio files are involved.

---

## Audio analysis

`lib/audio/analysis.ts` (`analyzeAudio`) measures:

- **Fundamental frequency** via the **YIN** algorithm (cumulative mean
  normalized difference + parabolic interpolation) with a confidence estimate.
  You can manually override the detected pitch.
- **Time-varying harmonic amplitudes**: a sequence of STFT frames tracks each
  partial's amplitude *trajectory* over the note (not just a single average),
  so evolving timbre can be reproduced. Each partial also yields a measured
  frequency and ratio.
- **Inharmonicity `B`**: estimated from how far measured partials drift from
  `n·f0`, via a magnitude-weighted least-squares fit to `(f_n/(n·f0))² − 1 = B·n²`.
  The peak-search window widens with the partial number so strongly-stretched
  upper partials (piano/bell) are still found.
- **Spectral envelope**: a coarse `(freq, gain-dB)` curve across log-spaced bands.
- **Spectral flux** (how fast the spectrum changes) and **noisiness** (energy
  outside the harmonic peaks).
- **Spectral features**: centroid, bandwidth, 85% rolloff; zero-crossing rate.
- **Amplitude envelope**: an RMS envelope plus heuristic ADSR extraction.

The Analysis panel displays these. One click bridges analysis → synthesis:

- **Apply Analysis → Synth**: runs the heuristic predictor to build a full
  high-dimensional patch — per-partial amplitudes **and time-varying envelopes**,
  measured frequency ratios, spectral envelope, brightness envelope from flux,
  and transient/noise layers when the attack/noisiness warrant them.

---

## Similarity / loss

`lib/audio/compare.ts` (`compareSignals`) produces a transparent breakdown of
objective signal distances, each in `0..1`. The optimizer minimizes the
**weighted loss** `1 − overall`; all weights are configurable in the UI:

| Component     | How it's computed |
|---------------|-------------------|
| Waveform      | normalized cross-correlation of the onset region |
| Multi-STFT    | log-magnitude STFT distance at **512 / 1024 / 2048 / 4096** — small FFTs capture transient timing, large FFTs capture fine spectral structure |
| Harmonic      | cosine similarity of reference vs. synth harmonic-amplitude vectors |
| Spectral env  | dB distance between coarse spectral envelopes |
| Amp envelope  | L1 distance of normalized amplitude envelopes |
| Transient     | correlation of the first ~50 ms energy shape |
| Centroid      | relative spectral-centroid difference (reported, not weighted by default) |

The **overall** score is the configurable weighted blend. This is intentionally
exposed so you can see *which* aspects match. **It is an experimental metric and
does not perfectly represent human perceptual similarity.**

---

## Optimization (Auto Match)

`lib/audio/optimizer.ts` (`autoMatch`) runs the full pipeline:

1. Analyze the reference.
2. Predict a high-dimensional initial patch (`HeuristicParameterPredictor`).
3. Render + compute the weighted loss.
4. Optimize the parameter vector with **differential evolution** (a gradient-free
   global optimizer — appropriate because the engine is not differentiable).
5. **Coordinate-descent polish** on the best vector.
6. Return the best parameters found.

The genome spans **per-partial amplitudes** (up to 32 by default), global
inharmonicity, spectral tilt, transient level/duration, noise level, and the
partial-bank gain. To stay responsive, rendering/comparison during optimization
runs at a reduced sample rate and duration, and the loop yields to the event
loop between iterations so the UI stays live and the run can be **stopped** at
any time. Progress (iteration, phase, current best similarity) is reported via
`onProgress`.

Runs are deterministic given a seed.

---

## Future AI architecture

The app is structured so an AI model can eventually **predict initial
parameters** from audio, without changing the rest of the app:

```ts
interface ParameterPredictor {
  readonly name: string;
  predict(analysis: AudioAnalysis): SynthParameters;
}
```

Today the shipped implementation is `HeuristicParameterPredictor` (classical
analysis → parameters). Later you can add a `NeuralParameterPredictor`
implementing the same interface — e.g. loading an ONNX model in a Web Worker, or
calling a Python backend — and the optimizer/UI pick it up transparently:

```
audio → NeuralParameterPredictor → good initial params → optimizer → final params
```

The intended progression: heuristic init → optimization (now) → neural init →
neural-assisted optimization (later). The AI is never required for the app to
work.

---

## Running locally

Requirements: **Node.js 18+** (developed on Node 24).

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
```

Then open the app, click **Upload audio**, drop in an isolated note, and press
**Auto Match** — or tweak the harmonic bars, envelope, filter, transient, and
noise by hand while watching the spectrum and similarity update in real time.

### A note on dependency advisories

The app pins `next@^14.2.33` (a patched 14.x release). `npm audit` may still
report a `postcss` advisory coming from **Next's own bundled copy**
(`node_modules/next/node_modules/postcss`), used only at build time. Clearing it
requires upgrading to Next 16 (a major breaking change); it does not affect the
shipped client bundle.

---

## Extending the synthesis engine

The engine is deliberately modular and React-free. To add a new synthesis module:

1. **Add parameters** to `SynthParameters` in `src/lib/synth/params.ts` and give
   them defaults in `defaultParameters()`. Keep everything JSON-serializable so
   presets and (future) AI prediction keep working.
2. **Implement the DSP** in `src/lib/synth/engine.ts` inside `renderSynth()`,
   mixing your module into the signal flow at the appropriate stage. Reuse
   helpers in `src/lib/synth/dsp.ts` (envelopes, filters, noise) and keep it
   deterministic (seed any randomness).
3. **Add a control panel** in `src/components/panels/SynthControls.tsx` using the
   shared primitives in `src/components/ui/controls.tsx`, and mount it in
   `src/app/page.tsx`.
4. **(Optional) expose it to Auto Match** by adding genes for the new parameters
   in `buildGenome()` in `src/lib/audio/optimizer.ts`.
5. **(Optional) map analysis → the new parameters** in
   `HeuristicParameterPredictor.predict()` in `src/lib/audio/predictor.ts`.

Because rendering is a pure function, you can unit-test any module by calling
`renderSynth()` and inspecting the returned `Float32Array` — no browser needed.

---

## Roadmap / planned extensions

- Optimize **per-partial amplitude envelopes** directly (currently the optimizer
  tunes per-partial peak amplitudes; the predictor sets the envelope shapes).
- Web Worker offload for analysis and Auto Match (the core is already
  worker-safe; only wiring remains).
- `NeuralParameterPredictor` for AI-assisted initial parameters.
- Optional Python backend for heavier ML/audio analysis (e.g. CREPE pitch,
  learned embeddings).

---

## License

Provided as-is for experimentation and learning.
