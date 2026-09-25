"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  type BreakpointEnvelope,
  evalBreakpoints,
} from "@/lib/synth/params";

/**
 * Editable breakpoint envelope. Click empty space to add a point, drag points
 * to move them, double-click a point to remove it. Supports arbitrary control
 * points so timbre/amplitude/etc. can follow any shape.
 */
export function EnvelopeEditor({
  env,
  onChange,
  height = 120,
  color = "#7cf5b0",
  overlay,
  overlayColor = "#4cc9f0",
  vMin = 0,
  vMax = 1,
}: {
  env: BreakpointEnvelope;
  onChange: (e: BreakpointEnvelope) => void;
  height?: number;
  color?: string;
  overlay?: Float32Array;
  overlayColor?: string;
  vMin?: number;
  vMax?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  const [drag, setDrag] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.floor(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = 6;
  const toX = (t: number) => pad + t * (width - 2 * pad);
  const toY = (v: number) =>
    height - pad - ((v - vMin) / (vMax - vMin)) * (height - 2 * pad);
  const fromX = (x: number) => Math.max(0, Math.min(1, (x - pad) / (width - 2 * pad)));
  const fromY = (y: number) =>
    Math.max(vMin, Math.min(vMax, vMin + (1 - (y - pad) / (height - 2 * pad)) * (vMax - vMin)));

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

    // grid
    ctx.strokeStyle = "#232a35";
    for (let i = 0; i <= 4; i++) {
      const y = pad + ((height - 2 * pad) / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // overlay (measured curve)
    if (overlay && overlay.length > 1) {
      ctx.strokeStyle = overlayColor;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      for (let px = 0; px < width; px++) {
        const t = (px - pad) / (width - 2 * pad);
        if (t < 0 || t > 1) continue;
        const idx = Math.floor(t * (overlay.length - 1));
        const y = toY(Math.max(vMin, Math.min(vMax, overlay[idx])));
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // envelope line (sampled through evalBreakpoints for correctness)
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px <= width; px++) {
      const t = fromX(px);
      const v = evalBreakpoints(env, t);
      const y = toY(v);
      if (px === 0) ctx.moveTo(toX(0), y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();

    // points
    for (const p of env.points) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(toX(p.t), toY(p.v), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // toX/toY/fromX derive from width/height/vMin/vMax which are already deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, width, height, color, overlay, overlayColor, vMin, vMax]);

  function nearestPoint(x: number, y: number): number | null {
    let best = -1;
    let bestD = 12;
    env.points.forEach((p, i) => {
      const d = Math.hypot(toX(p.t) - x, toY(p.v) - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best >= 0 ? best : null;
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const idx = nearestPoint(x, y);
    if (idx != null) {
      setDrag(idx);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      // add a point
      const t = fromX(x);
      const v = fromY(y);
      const points = [...env.points, { t, v }].sort((a, b) => a.t - b.t);
      onChange({ points });
    }
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (drag == null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const points = env.points.map((p, i) =>
      i === drag ? { t: fromX(x), v: fromY(y) } : p,
    );
    // keep endpoints roughly anchored in time order
    points.sort((a, b) => a.t - b.t);
    onChange({ points });
  }

  function onUp() {
    setDrag(null);
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const idx = nearestPoint(e.clientX - rect.left, e.clientY - rect.top);
    if (idx != null && env.points.length > 2) {
      onChange({ points: env.points.filter((_, i) => i !== idx) });
    }
  }

  return (
    <div ref={wrapRef} className="w-full">
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        className="cursor-crosshair rounded bg-base-900"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={onDoubleClick}
      />
      <p className="mt-1 text-[9px] text-ink-faint">
        click to add · drag to move · double-click to remove
      </p>
    </div>
  );
}
