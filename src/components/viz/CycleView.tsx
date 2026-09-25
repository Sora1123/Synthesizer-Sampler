"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * Single-cycle waveform display. Shows the shape of one period generated from
 * the partial bank so the user can see the waveform gain structure as they edit
 * harmonics. This makes it obvious that the generated waveform is NOT limited to
 * a simple sine/saw/triangle/square once many partials are active.
 */
export function CycleView({
  cycle,
  height = 110,
  color = "#f6a13a",
  label = "Generated single cycle",
}: {
  cycle: Float32Array;
  height?: number;
  color?: string;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);

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

    ctx.strokeStyle = "#232a35";
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    if (cycle.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px < width; px++) {
      const idx = Math.floor((px / width) * (cycle.length - 1));
      const v = cycle[idx];
      const y = height / 2 - v * (height / 2) * 0.9;
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();
  }, [cycle, width, height, color]);

  return (
    <div ref={wrapRef} className="w-full">
      <p className="mb-1 text-[10px] text-ink-muted">{label}</p>
      <canvas ref={canvasRef} style={{ width, height }} className="rounded bg-base-900" />
    </div>
  );
}
