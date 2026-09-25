"use client";

import React from "react";

export function Panel({
  title,
  children,
  right,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-3 ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="panel-header">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/**
 * Collapsible section used to keep the high-dimensional UI usable. `tier` tags
 * the section as BASIC / ADVANCED / EXPERT so the whole app can filter by
 * complexity level.
 */
export type Tier = "basic" | "advanced" | "expert";

export function ExpandableSection({
  title,
  tier = "basic",
  defaultOpen = false,
  right,
  children,
}: {
  title: string;
  tier?: Tier;
  defaultOpen?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const tierColor: Record<Tier, string> = {
    basic: "text-accent",
    advanced: "text-reference",
    expert: "text-synth",
  };
  return (
    <section className="panel overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 hover:bg-base-700"
      >
        <span className="flex items-center gap-2">
          <span className="text-ink-faint">{open ? "▾" : "▸"}</span>
          <span className="panel-header">{title}</span>
          <span className={`text-[9px] uppercase ${tierColor[tier]}`}>
            {tier}
          </span>
        </span>
        <span onClick={(e) => e.stopPropagation()}>{right}</span>
      </button>
      {open && <div className="border-t border-base-600 p-3">{children}</div>}
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  color = "accent",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  color?: string;
}) {
  return (
    <label className="block text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-ink-muted">{label}</span>
        <span className="tabular-nums text-ink">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ accentColor: `var(--${color})` }}
      />
    </label>
  );
}

export function NumberInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-ink-muted">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          className="w-full rounded bg-base-700 px-2 py-1 text-ink outline-none focus:ring-1 focus:ring-accent"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        {suffix && <span className="text-ink-faint">{suffix}</span>}
      </div>
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-ink-muted">{label}</span>
      <select
        className="w-full rounded bg-base-700 px-2 py-1 text-ink outline-none focus:ring-1 focus:ring-accent"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-accent"
      />
      {label}
    </label>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  title,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "reference" | "synth" | "danger";
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const variants: Record<string, string> = {
    default: "bg-base-600 hover:bg-base-500 text-ink",
    primary: "bg-accent hover:brightness-110 text-base-900 font-semibold",
    reference: "bg-reference hover:brightness-110 text-base-900 font-semibold",
    synth: "bg-synth hover:brightness-110 text-base-900 font-semibold",
    danger: "bg-danger hover:brightness-110 text-base-900 font-semibold",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
