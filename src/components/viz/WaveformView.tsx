"use client";

import React, { useEffect, useRef, useState } from "react";

const COLORS = {
  reference: "#4cc9f0",
  synth: "#f6a13a",
  grid: "#232a35",
  axis: "#5d6b7a",
};

interface Trace {
  samples: Float32Array;
  sampleRate: number;
  color: string;
  label: string;
}

/**
 * Waveform view: amplitude over time with time/amplitude axes and zoom.
 * Draws one or more traces (reference + synthesized overlay).
 */
export function WaveformView({
  traces,
  height = 160,
}: {
  traces: Trace[];
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(600);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.floor(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

    // Background grid.
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    // Zero line.
    ctx.strokeStyle = COLORS.axis;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Determine max duration among traces to align time axes.
    let maxDur = 0;
    for (const t of traces) {
      maxDur = Math.max(maxDur, t.samples.length / t.sampleRate);
    }
    if (maxDur === 0) return;
    const visibleDur = maxDur / zoom;

    for (const t of traces) {
      const total = Math.floor(visibleDur * t.sampleRate);
      const n = Math.min(total, t.samples.length);
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      const step = Math.max(1, Math.floor(n / width));
      for (let px = 0; px < width; px++) {
        const startIdx = Math.floor((px / width) * n);
        // min/max within this pixel column for a filled look.
        let min = 1;
        let max = -1;
        for (let k = 0; k < step; k++) {
          const idx = startIdx + k;
          if (idx >= t.samples.length) break;
          const s = t.samples[idx];
          if (s < min) min = s;
          if (s > max) max = s;
        }
        const yMax = height / 2 - max * (height / 2) * 0.95;
        const yMin = height / 2 - min * (height / 2) * 0.95;
        if (px === 0) ctx.moveTo(px, yMax);
        ctx.lineTo(px, yMax);
        ctx.lineTo(px, yMin);
      }
      ctx.stroke();
    }

    // Time axis labels.
    ctx.fillStyle = COLORS.axis;
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 4; i++) {
      const tSec = (visibleDur / 4) * i;
      ctx.fillText(`${(tSec * 1000).toFixed(0)}ms`, (width / 4) * i + 2, height - 3);
    }
  }, [traces, zoom, width, height]);

  return (
    <div ref={wrapRef} className="w-full">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex gap-3">
          {traces.map((t) => (
            <span key={t.label} className="flex items-center gap-1 text-[10px]">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: t.color }}
              />
              <span className="text-ink-muted">{t.label}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-ink-muted">
          <span>zoom</span>
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="tabular-nums">{zoom}×</span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        className="rounded bg-base-900"
      />
    </div>
  );
}

export { COLORS as WAVE_COLORS };
