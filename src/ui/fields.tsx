// Общие элементы ввода.

import { useEffect, useId, useState, type ReactNode } from 'react';

export function Field({ label, hint, wide, children }: { label: ReactNode; hint?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

function parse(text: string): number | null {
  const v = Number(text.replace(/\s/g, '').replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(v) ? null : v;
}

function show(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  return String(Math.round(v * 1000) / 1000).replace('.', ',');
}

interface NumProps {
  value: number | null;
  onChange(v: number): void;
  /** пустое поле: вызвать при очистке (для значений «авто») */
  onClear?(): void;
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  ariaLabel?: string;
}

/** Числовое поле с запятой, границами и единицей измерения. Значение уходит наружу при вводе корректного числа. */
export function Num({ value, onChange, onClear, min, max, unit, placeholder, className, id, ariaLabel }: NumProps) {
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(show(value));
  }, [value, focused]);

  const commit = (raw: string, clamp: boolean) => {
    const v = parse(raw);
    if (v == null) {
      if (raw.trim() === '' && onClear) onClear();
      return;
    }
    let out = v;
    if (clamp) {
      if (min != null) out = Math.max(min, out);
      if (max != null) out = Math.min(max, out);
    } else if ((min != null && v < min) || (max != null && v > max)) {
      return; // вне границ — ждём окончания ввода
    }
    if (out !== value) onChange(out);
  };

  const input = (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className={className}
      aria-label={ariaLabel}
      value={text}
      placeholder={placeholder}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        commit(e.target.value, false);
      }}
      onBlur={(e) => {
        setFocused(false);
        commit(e.target.value, true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
  if (!unit) return input;
  return (
    <span className="unit-wrap">
      {input}
      <span className="unit">{unit}</span>
    </span>
  );
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  id,
  ariaLabel,
}: {
  value: T;
  onChange(v: T): void;
  options: readonly { value: T; label: string }[];
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={String(value)}
      onChange={(e) => {
        const found = options.find((o) => String(o.value) === e.target.value);
        if (found) onChange(found.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Seg<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange(v: T): void;
  options: readonly { value: T; label: string }[];
  label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange(v: boolean): void; children: ReactNode }) {
  const id = useId();
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Text({ value, onChange, placeholder, type = 'text', id }: { value: string; onChange(v: string): void; placeholder?: string; type?: string; id?: string }) {
  return <input id={id} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** Раздел-аккордеон с кратким итогом в заголовке */
export function Acc({ title, summary, open, onToggle, children }: { title: string; summary?: ReactNode; open: boolean; onToggle(): void; children: ReactNode }) {
  return (
    <section className="acc" data-open={open}>
      <button type="button" className="acc-head" aria-expanded={open} onClick={onToggle}>
        <span className="acc-title">{title}</span>
        <span className="acc-sum">{open ? '' : summary}</span>
        <span className="acc-chev" aria-hidden="true" />
      </button>
      {open ? <div className="acc-body">{children}</div> : null}
    </section>
  );
}

export function Util({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls = value > 1.0001 ? 'over' : value > 0.9 ? 'hi' : '';
  return (
    <span className="util" title={`Использование сечения ${pct}%`}>
      <span className="util-bar">
        <i className={cls} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="num">{pct}%</span>
    </span>
  );
}
