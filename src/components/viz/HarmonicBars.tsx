"use client";

import React, { useRef, useState } from "react";

/**
 * Graphical harmonic-spectrum editor. Renders many partial amplitudes as
 * draggable bars (works for 32, 64, 128+). Dragging paints amplitudes; a
 * reference overlay (dashed) shows the target spectrum. A companion table view
 * (rendered by the panel) allows precise numeric editing.
 */
export function HarmonicBars({
  amplitudes,
  reference,
  onChange,
  height = 160,
}: {
  amplitudes: number[];
  reference?: number[];
  onChange?: (index: number, value: number) => void;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [painting, setPainting] = useState(false);
  const count = amplitudes.length;

  function idxFromEvent(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.floor((x / rect.width) * count);
    return Math.max(0, Math.min(count - 1, i));
  }
  function valFromEvent(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = 1 - (e.clientY - rect.top) / rect.height;
    return Math.max(0, Math.min(1, rel));
  }

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative w-full cursor-crosshair select-none rounded bg-base-900"
        style={{ height }}
        onPointerDown={(e) => {
          if (!onChange) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setPainting(true);
          onChange(idxFromEvent(e), valFromEvent(e));
        }}
        onPointerMove={(e) => {
          if (!onChange || !painting) return;
          onChange(idxFromEvent(e), valFromEvent(e));
        }}
        onPointerUp={() => setPainting(false)}
        onPointerLeave={() => setPainting(false)}
      >
        {/* bars */}
        <div className="absolute inset-0 flex items-end gap-px px-px">
          {amplitudes.map((amp, i) => (
            <div key={i} className="relative flex-1" style={{ height: "100%" }}>
              <div className="absolute inset-0 flex items-end">
                <div
                  className="w-full bg-synth"
                  style={{ height: `${amp * 100}%` }}
                />
              </div>
              {reference?.[i] != null && (
                <div
                  className="absolute left-0 right-0 border-t border-dashed border-reference"
                  style={{ bottom: `${(reference[i] as number) * 100}%` }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-ink-faint">
        <span>H1</span>
        <span>H{Math.round(count / 4)}</span>
        <span>H{Math.round(count / 2)}</span>
        <span>H{Math.round((3 * count) / 4)}</span>
        <span>H{count}</span>
      </div>
    </div>
  );
}

/** Numeric table view for precise partial editing (amplitude + ratio). */
export function HarmonicTable({
  partials,
  onAmplitude,
  onRatio,
  maxRows = 32,
}: {
  partials: { amplitude: number; frequencyRatio: number; enabled: boolean }[];
  onAmplitude: (i: number, v: number) => void;
  onRatio: (i: number, v: number) => void;
  maxRows?: number;
}) {
  return (
    <div className="max-h-48 overflow-y-auto">
      <table className="w-full text-[10px]">
        <thead className="sticky top-0 bg-base-700 text-ink-muted">
          <tr>
            <th className="px-1 text-left">#</th>
            <th className="px-1 text-left">amp</th>
            <th className="px-1 text-left">ratio</th>
          </tr>
        </thead>
        <tbody>
          {partials.slice(0, maxRows).map((p, i) => (
            <tr key={i} className={p.enabled ? "" : "opacity-40"}>
              <td className="px-1 text-ink-faint">H{i + 1}</td>
              <td className="px-1">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={Math.round(p.amplitude * 1000) / 1000}
                  onChange={(e) => onAmplitude(i, parseFloat(e.target.value) || 0)}
                  className="w-14 rounded bg-base-800 px-1 text-ink outline-none"
                />
              </td>
              <td className="px-1">
                <input
                  type="number"
                  min={0}
                  step={0.001}
                  value={Math.round(p.frequencyRatio * 1000) / 1000}
                  onChange={(e) => onRatio(i, parseFloat(e.target.value) || 0)}
                  className="w-16 rounded bg-base-800 px-1 text-ink outline-none"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
