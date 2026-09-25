"use client";

import React, { useEffect, useRef, useState } from "react";
import type { ADSRParams } from "@/lib/synth/params";
import { adsrDuration, evalADSR } from "@/lib/synth/dsp";

const COLORS = { line: "#7cf5b0", grid: "#232a35", axis: "#5d6b7a" };

/** Draws the ADSR envelope shape. Optionally overlays a measured curve. */
export function EnvelopeGraph({
  env,
  height = 120,
  overlay,
  overlayColor = "#4cc9f0",
}: {
  env: ADSRParams;
  height?: number;
  overlay?: Float32Array;
  overlayColor?: string;
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

    const dur = Math.max(0.05, adsrDuration(env));
    const pad = 4;

    // grid
    ctx.strokeStyle = COLORS.grid;
    for (let i = 0; i <= 2; i++) {
      const y = pad + ((height - 2 * pad) / 2) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // overlay measured curve (reference envelope) — spans its own duration but
    // is drawn normalized to full width for shape comparison.
    if (overlay && overlay.length > 1) {
      ctx.strokeStyle = overlayColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (let px = 0; px < width; px++) {
        const idx = Math.floor((px / width) * (overlay.length - 1));
        const v = overlay[idx];
        const x = px;
        const y = height - pad - v * (height - 2 * pad);
        if (px === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ADSR line
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px < width; px++) {
      const t = (px / width) * dur;
      const v = evalADSR(env, t);
      const x = px;
      const y = height - pad - v * (height - 2 * pad);
      if (px === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // stage boundary markers
    ctx.fillStyle = COLORS.axis;
    ctx.font = "9px ui-monospace, monospace";
    const stages: [string, number][] = [
      ["A", env.attack],
      ["D", env.attack + env.decay],
      ["S", env.attack + env.decay + env.hold],
      ["R", dur],
    ];
    for (const [label, tt] of stages) {
      const x = (tt / dur) * width;
      ctx.strokeStyle = "rgba(93,107,122,0.4)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillText(label, Math.min(x + 2, width - 8), 10);
    }
  }, [env, width, height, overlay, overlayColor]);

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
