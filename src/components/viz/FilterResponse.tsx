"use client";

import React, { useEffect, useRef, useState } from "react";
import { biquadCoeffs, type BiquadKind } from "@/lib/synth/dsp";
import type { FilterParams } from "@/lib/synth/params";

const COLORS = { line: "#f6a13a", grid: "#232a35", axis: "#5d6b7a" };

/** Draws the magnitude frequency response of the current filter. */
export function FilterResponse({
  filter,
  sampleRate = 44100,
  height = 90,
}: {
  filter: FilterParams;
  sampleRate?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(260);

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

    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    if (filter.type === "none") {
      ctx.fillStyle = COLORS.axis;
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText("filter off", 6, height / 2 - 4);
      return;
    }

    const kind: BiquadKind = filter.type;
    const c = biquadCoeffs(kind, filter.cutoff, filter.resonance, sampleRate);

    const minF = 20;
    const maxF = sampleRate / 2;
    const logMin = Math.log10(minF);
    const logMax = Math.log10(maxF);

    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px < width; px++) {
      const f = Math.pow(10, logMin + (px / width) * (logMax - logMin));
      const w = (2 * Math.PI * f) / sampleRate;
      // Evaluate |H(e^jw)| for the biquad.
      const cosw = Math.cos(w);
      const cos2w = Math.cos(2 * w);
      const sinw = Math.sin(w);
      const sin2w = Math.sin(2 * w);
      const numRe = c.b0 + c.b1 * cosw + c.b2 * cos2w;
      const numIm = -(c.b1 * sinw + c.b2 * sin2w);
      const denRe = 1 + c.a1 * cosw + c.a2 * cos2w;
      const denIm = -(c.a1 * sinw + c.a2 * sin2w);
      const num = Math.hypot(numRe, numIm);
      const den = Math.hypot(denRe, denIm) || 1e-9;
      const mag = num / den;
      const db = 20 * Math.log10(mag + 1e-9);
      // map -40..+20 dB to full height
      const y = height - ((db + 40) / 60) * height;
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();

    // cutoff marker
    const cx =
      ((Math.log10(filter.cutoff) - logMin) / (logMax - logMin)) * width;
    ctx.strokeStyle = "rgba(246,161,58,0.4)";
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.stroke();
  }, [filter, sampleRate, width, height]);

  return (
    <div ref={wrapRef} className="w-full">
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        className="rounded bg-base-900"
      />
    </div>
  );
}
