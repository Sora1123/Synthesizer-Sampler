"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { averageSpectrum, toDb } from "@/lib/dsp/fft";

const COLORS = {
  reference: "#4cc9f0",
  synth: "#f6a13a",
  grid: "#232a35",
  axis: "#5d6b7a",
};

interface SpecTrace {
  samples: Float32Array;
  sampleRate: number;
  color: string;
  label: string;
}

interface HoverInfo {
  x: number;
  y: number;
  freq: number;
  db: number;
  harmonic?: number;
}

/**
 * Frequency spectrum view. Log frequency axis, dB magnitude. Overlays multiple
 * traces and shows a hover readout of frequency + magnitude + harmonic number.
 */
export function SpectrumView({
  traces,
  fundamental,
  height = 200,
  minFreq = 20,
  maxFreq = 20000,
}: {
  traces: SpecTrace[];
  fundamental?: number;
  height?: number;
  minFreq?: number;
  maxFreq?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const spectra = useMemo(
    () =>
      traces.map((t) => ({
        ...t,
        spec: averageSpectrum(t.samples, t.sampleRate, 4096, 2048),
      })),
    [traces],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.floor(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);
  const freqToX = (f: number) =>
    ((Math.log10(Math.max(minFreq, f)) - logMin) / (logMax - logMin)) * width;
  const xToFreq = (x: number) =>
    Math.pow(10, logMin + (x / width) * (logMax - logMin));

  const dbMin = -90;
  const dbMax = 0;
  const dbToY = (db: number) =>
    height - ((db - dbMin) / (dbMax - dbMin)) * height;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Frequency grid lines (decades + labels).
    ctx.font = "10px ui-monospace, monospace";
    const marks = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    for (const m of marks) {
      if (m < minFreq || m > maxFreq) continue;
      const x = freqToX(m);
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillStyle = COLORS.axis;
      ctx.fillText(m >= 1000 ? `${m / 1000}k` : `${m}`, x + 2, height - 3);
    }
    // dB grid.
    for (let db = 0; db >= dbMin; db -= 20) {
      const y = dbToY(db);
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.axis;
      ctx.fillText(`${db}`, 2, y - 2);
    }

    // Fundamental + harmonic guide lines.
    if (fundamental && fundamental > 0) {
      for (let n = 1; n <= 24; n++) {
        const f = fundamental * n;
        if (f > maxFreq) break;
        const x = freqToX(f);
        ctx.strokeStyle = "rgba(124,245,176,0.12)";
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // Draw spectra.
    for (const t of spectra) {
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      let started = false;
      for (let i = 1; i < t.spec.magnitudes.length; i++) {
        const f = t.spec.freqs[i];
        if (f < minFreq || f > maxFreq) continue;
        const x = freqToX(f);
        const y = dbToY(toDb(t.spec.magnitudes[i]));
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    // freqToX/dbToY/dbMin are pure derivations of width/height/minFreq/maxFreq
    // which are already in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spectra, width, height, fundamental, minFreq, maxFreq, logMin, logMax]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const freq = xToFreq(x);
    // Read magnitude of the first (reference) trace at this freq.
    const primary = spectra[0];
    let db = dbMin;
    if (primary) {
      const bin = Math.round((freq / primary.sampleRate) * primary.spec.fftSize);
      const mag = primary.spec.magnitudes[bin] ?? 0;
      db = toDb(mag);
    }
    const harmonic =
      fundamental && fundamental > 0
        ? Math.round(freq / fundamental)
        : undefined;
    setHover({ x, y: dbToY(db), freq, db, harmonic });
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      <div className="mb-1 flex gap-3">
        {traces.map((t) => (
          <span key={t.label} className="flex items-center gap-1 text-[10px]">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: t.color }}
            />
            <span className="text-ink-muted">{t.label}</span>
          </span>
        ))}
        <span className="text-[10px] text-ink-faint">log freq · dB</span>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        className="rounded bg-base-900"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded bg-base-600 px-2 py-1 text-[10px] text-ink shadow"
          style={{
            left: Math.min(hover.x + 8, width - 110),
            top: 20,
          }}
        >
          <div>{hover.freq.toFixed(1)} Hz</div>
          <div>{hover.db.toFixed(1)} dB</div>
          {hover.harmonic && hover.harmonic >= 1 && (
            <div className="text-accent">harmonic ~H{hover.harmonic}</div>
          )}
        </div>
      )}
    </div>
  );
}
