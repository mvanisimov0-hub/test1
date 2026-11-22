// Схемы расположения элементов каркаса с марками — как в комплекте КМ:
// колонны и связи, элементы покрытия, продольные ряды, балки перекрытия, таблица марок.
// Всё строится проекцией поэлементной модели (structure.elements) блока.
// Размеры — в условных единицах листа шириной 1000; цвета — только из CSS-переменных.

import type { ReactElement, ReactNode } from 'react';
import type { BlockCalc } from '../domain/calc';
import type { Element3D } from '../domain/structTypes';
import { nf } from './format';

const W = 1000;
const FS = 13;
const FS_S = 12;
const MONO = 'var(--mono)';
const DASHDOT = '14 4 2 4';

const C = {
  line: 'var(--blue)',
  ink: 'var(--ink)',
  ink2: 'var(--ink-2)',
  thin: 'var(--ink-3)',
  accent: 'var(--accent)',
  paper: 'var(--surface)',
};

/** Буквенные оси по ГОСТ: без З, Й, О, Х, Ц, Ч, Щ, Ъ, Ы, Ь */
const AXIS_LETTERS = 'АБВГДЕЖИКЛМНПРСТУФШЭЮЯ'.split('');
const axisLetter = (j: number) => AXIS_LETTERS[j] ?? `А${j - AXIS_LETTERS.length + 1}`;
const mm = (m: number) => String(Math.round(m * 1000));
const level = (v: number) => (Math.abs(v) < 5e-4 ? '0,000' : `${v > 0 ? '+' : '−'}${nf(Math.abs(v), 3)}`);
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;
const key = (...v: number[]) => v.map((x) => x.toFixed(2)).join('|');

// ───────────────────────── подписи без наложений ─────────────────────────

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Label {
  x: number;
  y: number;
  text: string;
  fill: string;
  size: number;
}

/** Расставляет марки так, чтобы они не перекрывали друг друга и занятые области */
class LabelSet {
  private boxes: Box[] = [];
  readonly items: Label[] = [];

  /** занять область, в которую марки ставить нельзя */
  reserve(x0: number, y0: number, x1: number, y1: number): void {
    this.boxes.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
  }

  private free(b: Box): boolean {
    return !this.boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  }

  /**
   * Поставить марку у точки (x, y). offsets — варианты смещения [dx, dy]; берётся первый свободный.
   * Возвращает false, если места не нашлось (марка пропускается).
   */
  add(text: string, x: number, y: number, offsets: [number, number][] = AROUND, fill: string = C.ink, size = FS): boolean {
    const w = text.length * size * 0.66 + 4;
    for (const [dx, dy] of offsets) {
      const cx = dx === 0 ? x : x + Math.sign(dx) * (Math.abs(dx) + w / 2);
      const cy = y + dy;
      const box = { x0: cx - w / 2, y0: cy - size, x1: cx + w / 2, y1: cy + 4 };
      if (box.x0 < 2 || box.x1 > W - 2 || box.y0 < 2) continue;
      if (!this.free(box)) continue;
      this.boxes.push(box);
      this.items.push({ x: cx, y: cy, text, fill, size });
      return true;
    }
    return false;
  }

  render(): ReactNode {
    return this.items.map((l, i) => (
      <text
        key={`m${i}`}
        x={l.x}
        y={l.y}
        fontSize={l.size}
        fontFamily={MONO}
        fontWeight={600}
        textAnchor="middle"
        fill={l.fill}
        stroke={C.paper}
        strokeWidth={3.5}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {l.text}
      </text>
    ));
  }
}

const AROUND: [number, number][] = [
  [7, -7],
  [7, 15],
  [-7, -7],
  [-7, 15],
  [0, -11],
  [0, 21],
  [18, -7],
  [18, 15],
  [-18, -7],
  [7, -22],
  [7, 30],
];
const ABOVE: [number, number][] = [
  [0, -7],
  [0, 16],
  [0, -20],
  [0, 29],
  [14, -7],
  [-14, -7],
];

// ───────────────────────── общие элементы оформления ─────────────────────────

interface TxtProps {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  fill?: string;
  mono?: boolean;
  rotate?: boolean;
  weight?: number;
}

function Txt({ x, y, children, size = FS, anchor = 'middle', fill = C.ink, mono, rotate, weight }: TxtProps) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontFamily={mono ? MONO : 'inherit'}
      fontWeight={weight}
      textAnchor={anchor}
      fill={fill}
      stroke="none"
      transform={rotate ? `rotate(-90 ${x} ${y})` : undefined}
    >
      {children}
    </text>
  );
}

function Bubble({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={12} fill={C.paper} stroke={C.ink} strokeWidth={1.2} />
      <Txt x={x} y={y + 4.5} size={label.length > 2 ? 10 : FS_S} weight={600}>
        {label}
      </Txt>
    </g>
  );
}

function Tick({ x, y }: { x: number; y: number }) {
  return <line x1={x - 4} y1={y + 4} x2={x + 4} y2={y - 4} stroke={C.ink} strokeWidth={1.4} fill="none" />;
}

function DimH({ xs, y, yFrom, labels, single }: { xs: number[]; y: number; yFrom: number; labels?: string[]; single?: string }) {
  const a = xs[0];
  const b = xs[xs.length - 1];
  const pts = single ? [a, b] : xs;
  return (
    <g>
      {pts.map((x, i) => (
        <line key={`e${i}`} x1={x} y1={yFrom} x2={x} y2={y + 6} stroke={C.thin} strokeWidth={0.8} fill="none" />
      ))}
      <line x1={a - 6} y1={y} x2={b + 6} y2={y} stroke={C.thin} strokeWidth={0.9} fill="none" />
      {pts.map((x, i) => (
        <Tick key={`t${i}`} x={x} y={y} />
      ))}
      {single ? (
        <Txt x={(a + b) / 2} y={y - 5} size={FS_S} mono>
          {single}
        </Txt>
      ) : (
        labels?.map((l, i) => (
          <Txt key={`l${i}`} x={(xs[i] + xs[i + 1]) / 2} y={y - 5} size={FS_S} mono>
            {l}
          </Txt>
        ))
      )}
    </g>
  );
}

function DimV({ ys, x, xFrom, labels, single }: { ys: number[]; x: number; xFrom: number; labels?: string[]; single?: string }) {
  const a = ys[0];
  const b = ys[ys.length - 1];
  const pts = single ? [a, b] : ys;
  return (
    <g>
      {pts.map((y, i) => (
        <line key={`e${i}`} x1={xFrom} y1={y} x2={x - 6} y2={y} stroke={C.thin} strokeWidth={0.8} fill="none" />
      ))}
      <line x1={x} y1={Math.min(a, b) - 6} x2={x} y2={Math.max(a, b) + 6} stroke={C.thin} strokeWidth={0.9} fill="none" />
      {pts.map((y, i) => (
        <Tick key={`t${i}`} x={x} y={y} />
      ))}
      {single ? (
        <Txt x={x - 5} y={(a + b) / 2} size={FS_S} mono rotate>
          {single}
        </Txt>
      ) : (
        labels?.map((l, i) => (
          <Txt key={`l${i}`} x={x - 5} y={(ys[i] + ys[i + 1]) / 2} size={FS_S} mono rotate>
            {l}
          </Txt>
        ))
      )}
    </g>
  );
}

function Sheet({ height, label, children }: { height: number; label: string; children: ReactNode }) {
  return (
    <div className="drawing">
      <svg viewBox={`0 0 ${W} ${Math.ceil(height)}`} role="img" aria-label={label} style={{ fontFamily: 'inherit' }}>
        {children}
      </svg>
    </div>
  );
}

// ───────────────────────── геометрия плана ─────────────────────────

interface PlanGeom {
  L: number;
  B: number;
  s: number;
  X: (x: number) => number;
  Y: (z: number) => number;
  frames: number[];
  rows: number[];
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
  /** номера осей, которые подписываются (при частом шаге — через одну и реже) */
  shownAxes: Set<number>;
}

const ML = 118;
const MR = 44;
const MT = 48;
const MB = 112;

function planGeom(block: BlockCalc): PlanGeom {
  const b = block.project.building;
  const L = Math.max(0.5, b.length);
  const B = Math.max(0.5, b.width);
  const s = Math.min((W - ML - MR) / L, 540 / B);
  const left = ML + (W - ML - MR - L * s) / 2;
  const top = MT;
  const frames = block.structure.frames.length ? block.structure.frames : [0, L];
  const nSpans = Math.max(1, b.spans);
  const rows = Array.from({ length: nSpans + 1 }, (_, j) => (j * B) / nSpans);
  const minGap = frames.length > 1 ? Math.min(...frames.slice(1).map((x, i) => x - frames[i])) * s : 100;
  const every = Math.max(1, Math.ceil(27 / Math.max(1, minGap)));
  const shownAxes = new Set<number>();
  frames.forEach((_, i) => {
    if (i % every === 0 || i === frames.length - 1) shownAxes.add(i);
  });
  // последняя подпись не должна налезать на предпоследнюю
  if (every > 1 && frames.length > 2) {
    const last = frames.length - 1;
    const prev = Math.floor((last - 1) / every) * every;
    if (prev !== last && (frames[last] - frames[prev]) * s < 27) shownAxes.delete(prev);
  }
  return {
    L,
    B,
    s,
    X: (x) => left + x * s,
    Y: (z) => top + (B - z) * s,
    frames,
    rows,
    top,
    bottom: top + B * s,
    left,
    right: left + L * s,
    height: top + B * s + MB,
    shownAxes,
  };
}

/** Оси, марки осей и размерные цепочки плана. Вызывается как функция: занимает места под марки сразу */
function planBase(g: PlanGeom, labels: LabelSet): ReactNode {
  const { X, Y, frames, rows, L, B, s } = g;
  const xs = frames.map(X);
  const ys = rows.map(Y);
  const steps = frames.slice(1).map((x, i) => x - frames[i]);
  const equal = steps.every((d) => near(d, steps[0], 0.005));
  const tight = steps.some((d) => d * s < 46);
  const bubbleY = g.bottom + 84;
  const bubbleX = g.left - 82;
  // места, куда марки ставить нельзя
  labels.reserve(0, g.bottom + 14, W, g.height);
  labels.reserve(0, 0, g.left - 12, g.height);
  return (
    <g>
      {frames.map((x, i) => (
        <line key={`ax${i}`} x1={X(x)} y1={g.top - 16} x2={X(x)} y2={bubbleY - 12} stroke={C.thin} strokeWidth={0.8} strokeDasharray={DASHDOT} fill="none" />
      ))}
      {rows.map((z, j) => (
        <line key={`az${j}`} x1={bubbleX + 12} y1={Y(z)} x2={g.right + 18} y2={Y(z)} stroke={C.thin} strokeWidth={0.8} strokeDasharray={DASHDOT} fill="none" />
      ))}
      {frames.length > 1 ? (
        tight || !equal ? (
          tight ? (
            <DimH xs={xs} y={g.bottom + 30} yFrom={g.bottom + 6} single={equal ? `${steps.length} × ${mm(steps[0])} = ${mm(L)}` : mm(L)} />
          ) : (
            <DimH xs={xs} y={g.bottom + 30} yFrom={g.bottom + 6} labels={steps.map(mm)} />
          )
        ) : (
          <DimH xs={xs} y={g.bottom + 30} yFrom={g.bottom + 6} labels={steps.map(mm)} />
        )
      ) : null}
      {!tight && frames.length > 2 ? <DimH xs={[xs[0], xs[xs.length - 1]]} y={g.bottom + 56} yFrom={g.bottom + 36} single={mm(L)} /> : null}
      {rows.length > 2 ? <DimV ys={ys} x={g.left - 28} xFrom={g.left - 6} labels={rows.slice(1).map((z, j) => mm(z - rows[j]))} /> : null}
      <DimV ys={[ys[0], ys[ys.length - 1]]} x={g.left - (rows.length > 2 ? 54 : 28)} xFrom={g.left - (rows.length > 2 ? 34 : 6)} single={mm(B)} />
      {frames.map((x, i) => (g.shownAxes.has(i) ? <Bubble key={`bx${i}`} x={X(x)} y={bubbleY} label={String(i + 1)} /> : null))}
      {rows.map((z, j) => (
        <Bubble key={`bz${j}`} x={bubbleX} y={Y(z)} label={axisLetter(j)} />
      ))}
    </g>
  );
}

// ───────────────────────── выборки элементов ─────────────────────────

interface Post {
  x: number;
  z: number;
  mark: string;
  main: boolean;
}

function posts(elements: Element3D[]): Post[] {
  const seen = new Set<string>();
  const out: Post[] = [];
  for (const e of elements) {
    if (e.role !== 'column' && e.role !== 'fakhverk') continue;
    const k = key(e.a[0], e.a[2]);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x: e.a[0], z: e.a[2], mark: e.mark, main: e.mark === 'К1' || e.mark === 'К2' });
  }
  return out;
}

interface Seg {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  mark: string;
}

/** Отрезки элементов в плане без повторов (крестовая связь даёт в плане один отрезок) */
function planSegs(elements: Element3D[], pick: (e: Element3D) => boolean): Seg[] {
  const seen = new Set<string>();
  const out: Seg[] = [];
  for (const e of elements) {
    if (!pick(e)) continue;
    const p: [number, number] = [e.a[0], e.a[2]];
    const q: [number, number] = [e.b[0], e.b[2]];
    const [m, n] = p[0] < q[0] - 1e-6 || (near(p[0], q[0], 1e-6) && p[1] <= q[1]) ? [p, q] : [q, p];
    if (Math.hypot(n[0] - m[0], n[1] - m[1]) < 0.02) continue;
    const k = `${e.mark}|${key(m[0], m[1], n[0], n[1])}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x1: m[0], z1: m[1], x2: n[0], z2: n[1], mark: e.mark });
  }
  return out;
}

/** Склеить продольные отрезки (вдоль x) одной линии z в сплошные участки */
function mergeAlongX(segs: Seg[]): Seg[] {
  const byZ = new Map<string, Seg[]>();
  for (const s of segs) {
    if (!near(s.z1, s.z2, 0.02)) continue;
    const k = `${s.mark}|${s.z1.toFixed(2)}`;
    byZ.set(k, [...(byZ.get(k) ?? []), s]);
  }
  const out: Seg[] = [];
  for (const list of byZ.values()) {
    list.sort((a, b) => a.x1 - b.x1);
    let cur = { ...list[0] };
    for (const s of list.slice(1)) {
      if (s.x1 <= cur.x2 + 0.02) cur.x2 = Math.max(cur.x2, s.x2);
      else {
        out.push(cur);
        cur = { ...s };
      }
    }
    out.push(cur);
  }
  return out;
}

function postMarks(list: Post[], g: PlanGeom, labels: LabelSet): ReactNode {
  const { X, Y } = g;
  // сначала колонны занимают место, потом ставятся марки
  for (const p of list) labels.reserve(X(p.x) - 6, Y(p.z) - 6, X(p.x) + 6, Y(p.z) + 6);
  const done = new Set<string>();
  const sorted = [...list].sort((a, b) => a.z - b.z || a.x - b.x);
  for (const p of sorted) {
    // основные колонны и стойки перекрытия — первая в каждом ряду; фахверк — по одной на торец
    const k = p.mark === 'ФС1' ? `${p.mark}|x${p.x.toFixed(2)}` : `${p.mark}|z${p.z.toFixed(2)}`;
    if (done.has(k)) continue;
    done.add(k);
    labels.add(p.mark, X(p.x), Y(p.z));
  }
  return (
    <g>
      {list.map((p, i) =>
        p.main ? (
          <rect key={`p${i}`} x={X(p.x) - 5} y={Y(p.z) - 5} width={10} height={10} fill={C.line} stroke={C.line} strokeWidth={1} />
        ) : (
          <rect key={`p${i}`} x={X(p.x) - 3.5} y={Y(p.z) - 3.5} width={7} height={7} fill={C.paper} stroke={C.line} strokeWidth={1.3} />
        ),
      )}
    </g>
  );
}

function Caption({ g, children }: { g: PlanGeom; children: ReactNode }) {
  return (
    <Txt x={g.left} y={18} anchor="start" size={FS_S} fill={C.ink2}>
      {children}
    </Txt>
  );
}

// ───────────────────────── схема колонн и связей ─────────────────────────

export function ColumnsPlan({ block }: { block: BlockCalc }): ReactElement {
  const g = planGeom(block);
  const { X, Y } = g;
  const els = block.structure.elements;
  const labels = new LabelSet();
  const base = planBase(g, labels);
  const list = posts(els);
  const braces = planSegs(els, (e) => e.role === 'brace' && e.mark !== 'СГ1');
  const postNodes = postMarks(list, g, labels);
  for (const s of braces) {
    const mx = (X(s.x1) + X(s.x2)) / 2;
    const my = (Y(s.z1) + Y(s.z2)) / 2;
    labels.reserve(mx - 6, my - 6, mx + 6, my + 6);
  }
  // сначала марки поперечных связей (им нужно место сбоку), затем продольных
  const ordered = [...braces].sort((p, q) => Number(near(p.z1, p.z2, 0.02)) - Number(near(q.z1, q.z2, 0.02)));
  for (const s of ordered) {
    const mx = (X(s.x1) + X(s.x2)) / 2;
    const my = (Y(s.z1) + Y(s.z2)) / 2;
    const alongX = near(s.z1, s.z2, 0.02);
    labels.add(s.mark, mx, my, alongX ? ABOVE : AROUND, C.accent);
  }
  return (
    <Sheet height={g.height} label="Схема расположения колонн и связей">
      <Caption g={g}>Схема расположения колонн и вертикальных связей. Размеры в мм.</Caption>
      {base}
      {braces.map((s, i) => {
        const mx = (X(s.x1) + X(s.x2)) / 2;
        const my = (Y(s.z1) + Y(s.z2)) / 2;
        return (
          <g key={`b${i}`}>
            <line x1={X(s.x1)} y1={Y(s.z1)} x2={X(s.x2)} y2={Y(s.z2)} stroke={C.accent} strokeWidth={2.4} strokeDasharray="7 4" fill="none" />
            <path d={`M${mx - 5} ${my - 5}L${mx + 5} ${my + 5}M${mx - 5} ${my + 5}L${mx + 5} ${my - 5}`} stroke={C.accent} strokeWidth={1.8} fill="none" />
          </g>
        );
      })}
      {postNodes}
      {labels.render()}
    </Sheet>
  );
}

// ───────────────────────── схема элементов покрытия ─────────────────────────

/** Марки ферм по пролётам: одинаковые по высотам на опорах фермы получают одну марку */
function trussMarks(block: BlockCalc): string[] {
  const b = block.project.building;
  const nSpans = Math.max(1, b.spans);
  const Ls = b.width / nSpans;
  const x0 = block.structure.frames[0] ?? 0;
  const tr = block.structure.elements.filter((e) => e.role === 'truss' && near(e.a[0], x0, 0.01));
  const sigs: string[] = [];
  const marks: string[] = [];
  for (let j = 0; j < nSpans; j++) {
    const zA = j * Ls;
    const zB = zA + Ls;
    const inSpan = tr.filter((e) => Math.min(e.a[2], e.b[2]) >= zA - 0.01 && Math.max(e.a[2], e.b[2]) <= zB + 0.01);
    const depthAt = (z: number) => {
      const ys: number[] = [];
      for (const e of inSpan) {
        if (near(e.a[2], z, 0.01)) ys.push(e.a[1]);
        if (near(e.b[2], z, 0.01)) ys.push(e.b[1]);
      }
      return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    };
    const d = [depthAt(zA), depthAt(zB)].sort((p, q) => p - q);
    const sig = d.map((v) => v.toFixed(2)).join('/');
    let idx = sigs.indexOf(sig);
    if (idx < 0) {
      sigs.push(sig);
      idx = sigs.length - 1;
    }
    marks.push(`Ф${idx + 1}`);
  }
  return marks;
}

export function RoofFramingPlan({ block }: { block: BlockCalc }): ReactElement {
  const g = planGeom(block);
  const { X, Y, frames, rows } = g;
  const els = block.structure.elements;
  const st = block.structure;
  const labels = new LabelSet();
  const base = planBase(g, labels);

  // несущие конструкции покрытия: по одной линии на раму и пролёт
  const main: { x: number; z1: number; z2: number; mark: string }[] = [];
  if (st.scheme === 'truss') {
    const tm = trussMarks(block);
    const xsWith = new Set(els.filter((e) => e.role === 'truss').map((e) => e.a[0].toFixed(2)));
    for (const x of frames) {
      if (!xsWith.has(x.toFixed(2))) continue;
      for (let j = 0; j < rows.length - 1; j++) main.push({ x, z1: rows[j], z2: rows[j + 1], mark: tm[j] ?? 'Ф1' });
    }
  } else {
    for (const s of planSegs(els, (e) => e.role === 'rafter')) main.push({ x: s.x1, z1: s.z1, z2: s.z2, mark: s.mark });
  }
  const purlins = mergeAlongX(planSegs(els, (e) => e.role === 'purlin'));
  // распорки по колоннам — только верхний уровень каждого ряда
  const topY = new Map<string, number>();
  for (const e of els) {
    if (e.mark !== 'Р1') continue;
    const k = e.a[2].toFixed(2);
    topY.set(k, Math.max(topY.get(k) ?? -Infinity, e.a[1]));
  }
  const struts = mergeAlongX(
    planSegs(els, (e) => (e.mark === 'Р1' && near(e.a[1], topY.get(e.a[2].toFixed(2)) ?? 0, 0.02)) || e.mark === 'Р2'),
  );
  const braces = planSegs(els, (e) => e.mark === 'СГ1');
  const cols = posts(els).filter((p) => p.main);

  for (const m of main) labels.reserve(X(m.x) - 3, Y(m.z2), X(m.x) + 3, Y(m.z1));
  // марки несущих конструкций — у первой и последней рамы, в каждом пролёте
  const xsMain = [...new Set(main.map((m) => m.x.toFixed(2)))].map(Number).sort((a, b) => a - b);
  const markAt = xsMain.length > 1 ? [xsMain[0], xsMain[xsMain.length - 1]] : xsMain;
  const seenMain = new Set<string>();
  for (const m of main) {
    if (!markAt.some((x) => near(x, m.x, 0.01))) continue;
    const k = `${m.x.toFixed(2)}|${Math.min(m.z1, m.z2).toFixed(1)}|${m.mark}`;
    if (seenMain.has(k)) continue;
    seenMain.add(k);
    const first = near(m.x, xsMain[0], 0.01);
    const yy = Y(m.z1 + (m.z2 - m.z1) * 0.3);
    labels.add(m.mark, X(m.x), yy + 4, first ? [[7, 0], [-7, 0], [7, -18], [7, 18]] : [[-7, 0], [7, 0], [-7, -18], [-7, 18]]);
  }
  // по одной-две марки на прогоны, распорки и связи
  const bay = frames.length > 1 ? Math.min(1, frames.length - 2) : 0;
  const midX = frames.length > 1 ? (frames[bay] + frames[bay + 1]) / 2 : g.L / 2;
  const inner = purlins.filter((p) => !rows.some((z) => near(z, p.z1, 0.3)));
  const pickPurlin = inner[Math.floor(inner.length / 3)] ?? purlins[Math.floor(purlins.length / 2)];
  if (pickPurlin) labels.add(pickPurlin.mark, X(Math.min(Math.max(midX, pickPurlin.x1), pickPurlin.x2)), Y(pickPurlin.z1), ABOVE, C.ink);
  const strutMarks = new Set<string>();
  for (const s of struts) {
    if (strutMarks.has(s.mark)) continue;
    const lastBay = frames.length > 2 ? (frames[frames.length - 2] + frames[frames.length - 1]) / 2 : midX;
    const ok = labels.add(s.mark, X(Math.min(Math.max(s.mark === 'Р1' ? lastBay : midX, s.x1), s.x2)), Y(s.z1), ABOVE, C.ink2);
    if (ok) strutMarks.add(s.mark);
  }
  let braceMarks = 0;
  for (const s of braces) {
    if (braceMarks >= 2) break;
    if (braceMarks === 1 && near(s.x1, braces[0].x1, 0.01)) continue;
    const mx = (X(s.x1) + X(s.x2)) / 2;
    const my = (Y(s.z1) + Y(s.z2)) / 2;
    if (labels.add(s.mark, mx, my, [[0, -9], [0, 18], [16, -9], [-16, -9], [16, 18]], C.accent)) braceMarks++;
  }

  return (
    <Sheet height={g.height} label="Схема расположения элементов покрытия">
      <Caption g={g}>
        Схема расположения элементов покрытия: {st.scheme === 'truss' ? 'фермы' : 'ригели рам'}, прогоны, связи, распорки. Размеры в мм.
      </Caption>
      {base}
      {purlins.map((s, i) => (
        <line key={`p${i}`} x1={X(s.x1)} y1={Y(s.z1)} x2={X(s.x2)} y2={Y(s.z2)} stroke={C.line} strokeWidth={1} fill="none" />
      ))}
      {struts.map((s, i) => (
        <line key={`s${i}`} x1={X(s.x1)} y1={Y(s.z1)} x2={X(s.x2)} y2={Y(s.z2)} stroke={C.ink2} strokeWidth={1.6} strokeDasharray="9 3" fill="none" />
      ))}
      {braces.map((s, i) => (
        <line key={`b${i}`} x1={X(s.x1)} y1={Y(s.z1)} x2={X(s.x2)} y2={Y(s.z2)} stroke={C.accent} strokeWidth={1.3} fill="none" />
      ))}
      {main.map((m, i) => (
        <line key={`m${i}`} x1={X(m.x)} y1={Y(m.z1)} x2={X(m.x)} y2={Y(m.z2)} stroke={C.line} strokeWidth={3.2} fill="none" />
      ))}
      {cols.map((p, i) => (
        <rect key={`c${i}`} x={X(p.x) - 4} y={Y(p.z) - 4} width={8} height={8} fill={C.paper} stroke={C.thin} strokeWidth={1.1} />
      ))}
      {labels.render()}
    </Sheet>
  );
}

// ───────────────────────── схема балок перекрытия ─────────────────────────

export function FloorFramingPlan({ block }: { block: BlockCalc }): ReactElement | null {
  const els = block.structure.elements;
  const floor = els.filter((e) => e.role === 'floor');
  if (!floor.length) return null;
  const y0 = Math.min(...floor.map((e) => e.a[1]));
  const lvl = floor.filter((e) => near(e.a[1], y0, 0.02) && near(e.b[1], y0, 0.02));
  const g = planGeom(block);
  const { X, Y } = g;
  const labels = new LabelSet();
  const base = planBase(g, labels);
  const mainBeams = planSegs(lvl, (e) => e.mark === 'БП1');
  const secondary = mergeAlongX(planSegs(lvl, (e) => e.mark === 'БП2'));
  const xMax = Math.max(...lvl.map((e) => Math.max(e.a[0], e.b[0])));
  const xMin = Math.min(...lvl.map((e) => Math.min(e.a[0], e.b[0])));
  const list = posts(els).filter((p) => p.x >= xMin - 0.05 && p.x <= xMax + 0.05 && p.mark !== 'ФС1');
  for (const m of mainBeams) labels.reserve(X(m.x1) - 3, Y(Math.max(m.z1, m.z2)), X(m.x1) + 3, Y(Math.min(m.z1, m.z2)));
  const postNodes = postMarks(list, g, labels);
  const firstMain = mainBeams.find((m) => near(m.x1, xMin, 0.01)) ?? mainBeams[0];
  const lastMain = [...mainBeams].reverse().find((m) => near(m.x1, xMax, 0.01));
  if (firstMain) labels.add(firstMain.mark, X(firstMain.x1), (Y(firstMain.z1) + Y(firstMain.z2)) / 2 + 4, [[7, 0], [-7, 0], [7, -18], [7, 18]]);
  if (lastMain && lastMain !== firstMain) labels.add(lastMain.mark, X(lastMain.x1), (Y(lastMain.z1) + Y(lastMain.z2)) / 2 + 4, [[-7, 0], [7, 0], [-7, -18], [-7, 18]]);
  const sec = secondary[Math.floor(secondary.length / 2)];
  if (sec) labels.add(sec.mark, (X(sec.x1) + X(sec.x2)) / 2, Y(sec.z1), ABOVE, C.ink2);
  const partial = xMax < g.L - 0.05;
  return (
    <Sheet height={g.height} label="Схема расположения балок перекрытия">
      <Caption g={g}>
        Схема расположения балок перекрытия на отм. {level(y0)}
        {partial ? ` (в осях 1–${g.frames.findIndex((x) => near(x, xMax, 0.05)) + 1})` : ''}. Размеры в мм.
      </Caption>
      {base}
      <rect x={X(xMin)} y={Y(g.B)} width={X(xMax) - X(xMin)} height={Y(0) - Y(g.B)} fill="none" stroke={C.thin} strokeWidth={0.9} strokeDasharray="5 4" />
      {secondary.map((s, i) => (
        <line key={`s${i}`} x1={X(s.x1)} y1={Y(s.z1)} x2={X(s.x2)} y2={Y(s.z2)} stroke={C.line} strokeWidth={1.1} fill="none" />
      ))}
      {mainBeams.map((s, i) => (
        <line key={`m${i}`} x1={X(s.x1)} y1={Y(s.z1)} x2={X(s.x2)} y2={Y(s.z2)} stroke={C.line} strokeWidth={3} fill="none" />
      ))}
      {postNodes}
      {labels.render()}
    </Sheet>
  );
}

// ───────────────────────── схема по продольному ряду ─────────────────────────

function rowLetter(block: BlockCalc, row: number): string {
  const b = block.project.building;
  const nSpans = Math.max(1, b.spans);
  const j = Math.round((row / Math.max(0.01, b.width)) * nSpans);
  return axisLetter(Math.min(Math.max(j, 0), nSpans));
}

export function RowElevation({ block, row = 0 }: { block: BlockCalc; row?: number }): ReactElement {
  const b = block.project.building;
  const st = block.structure;
  const L = Math.max(0.5, b.length);
  const frames = st.frames.length ? st.frames : [0, L];
  const inPlane = st.elements.filter((e) => e.role !== 'crane' && near(e.a[2], row) && near(e.b[2], row));
  const cranes = st.elements.filter((e) => e.role === 'crane' && Math.abs(e.a[2] - row) <= 0.7 && Math.abs(e.b[2] - row) <= 0.7);
  const all = [...inPlane, ...cranes];
  const hMax = Math.max(b.height, ...all.map((e) => Math.max(e.a[1], e.b[1])), 1);
  const mlE = 86;
  const mrE = 190;
  const s = Math.min((W - mlE - mrE) / L, 330 / hMax);
  const left = mlE + (W - mlE - mrE - L * s) / 2;
  const top = 44;
  const ground = top + hMax * s;
  const X = (x: number) => left + x * s;
  const Y = (y: number) => ground - y * s;
  const right = X(L);
  const height = ground + 84;
  const labels = new LabelSet();
  labels.reserve(0, ground + 4, W, height);
  labels.reserve(right + 14, 0, W, height);

  const g = planGeom(block);
  const cols = inPlane.filter((e) => e.role === 'column' || e.role === 'fakhverk');
  const others = inPlane.filter((e) => e.role !== 'column' && e.role !== 'fakhverk');
  for (const c of cols) labels.reserve(X(c.a[0]) - 4, Y(Math.max(c.a[1], c.b[1])), X(c.a[0]) + 4, Y(Math.min(c.a[1], c.b[1])));

  // марки: колонны — у первой; остальные — по одной на марку (связи — в каждом связевом шаге)
  const done = new Set<string>();
  const colSorted = [...cols].sort((p, q) => p.a[0] - q.a[0]);
  for (const c of colSorted) {
    if (done.has(c.mark)) continue;
    done.add(c.mark);
    const yTop = Math.max(c.a[1], c.b[1]);
    labels.add(c.mark, X(c.a[0]), Y(yTop * 0.55), [[8, 0], [-8, 0], [8, -18], [8, 18]]);
  }
  const braceBays = new Set<string>();
  for (const e of others) {
    const mx = (X(e.a[0]) + X(e.b[0])) / 2;
    const my = (Y(e.a[1]) + Y(e.b[1])) / 2;
    if (e.role === 'brace') {
      const k = `${e.mark}|${Math.min(e.a[0], e.b[0]).toFixed(2)}`;
      if (braceBays.has(k)) continue;
      braceBays.add(k);
      // марка — на четверти длины диагонали, чтобы не попасть в перекрестье
      labels.add(e.mark, X(e.a[0]) + (X(e.b[0]) - X(e.a[0])) * 0.27, Y(e.a[1]) + (Y(e.b[1]) - Y(e.a[1])) * 0.27, AROUND, C.accent);
      continue;
    }
    if (done.has(e.mark) || e.mark === 'Ф') continue;
    const horizontal = near(e.a[1], e.b[1], 0.02);
    if (labels.add(e.mark, mx, my, horizontal ? ABOVE : AROUND, e.role === 'opening' ? C.ink2 : C.ink)) done.add(e.mark);
  }
  for (const e of cranes) {
    if (done.has(e.mark)) continue;
    if (labels.add(e.mark, (X(e.a[0]) + X(e.b[0])) / 2, Y(e.a[1]), ABOVE, C.accent)) done.add(e.mark);
  }

  const colTop = cols.filter((c) => c.role === 'column').reduce((m, c) => Math.max(m, c.a[1], c.b[1]), 0);
  const craneY = cranes.length ? cranes[0].a[1] : null;
  const marksY: { y: number; text: string }[] = [{ y: 0, text: level(0) }];
  if (colTop > 0) marksY.push({ y: colTop, text: `${level(colTop)} верх колонн` });
  if (craneY != null && Math.abs(craneY - colTop) * s > 16) marksY.push({ y: craneY, text: `${level(craneY)} кран` });

  const stroke = (e: Element3D): { c: string; w: number; dash?: string } => {
    switch (e.role) {
      case 'strut':
        return { c: C.line, w: 2 };
      case 'brace':
        return { c: C.accent, w: 1.4 };
      case 'girt':
        return { c: C.line, w: 1.1 };
      case 'opening':
        return { c: C.ink2, w: 1.1 };
      case 'purlin':
        return { c: C.thin, w: 1 };
      default:
        return { c: C.line, w: 1.2 };
    }
  };

  return (
    <Sheet height={height} label={`Схема по ряду ${rowLetter(block, row)}`}>
      <Txt x={left} y={18} anchor="start" size={FS_S} fill={C.ink2}>
        Схема расположения элементов по ряду {rowLetter(block, row)}: колонны, распорки, вертикальные связи.
      </Txt>
      {frames.map((x, i) => (
        <line key={`ax${i}`} x1={X(x)} y1={top - 10} x2={X(x)} y2={ground + 46} stroke={C.thin} strokeWidth={0.8} strokeDasharray={DASHDOT} fill="none" />
      ))}
      <line x1={left - 30} y1={ground} x2={right + 30} y2={ground} stroke={C.ink} strokeWidth={1.4} fill="none" />
      {Array.from({ length: Math.floor((right - left + 60) / 14) }, (_, i) => (
        <line key={`h${i}`} x1={left - 30 + i * 14 + 8} y1={ground} x2={left - 30 + i * 14} y2={ground + 8} stroke={C.thin} strokeWidth={0.8} fill="none" />
      ))}
      {others.map((e, i) => {
        const k = stroke(e);
        return <line key={`o${i}`} x1={X(e.a[0])} y1={Y(e.a[1])} x2={X(e.b[0])} y2={Y(e.b[1])} stroke={k.c} strokeWidth={k.w} strokeDasharray={k.dash} fill="none" />;
      })}
      {cranes.map((e, i) => (
        <line key={`cr${i}`} x1={X(e.a[0])} y1={Y(e.a[1])} x2={X(e.b[0])} y2={Y(e.b[1])} stroke={C.accent} strokeWidth={2} strokeDasharray="8 4" fill="none" />
      ))}
      {cols.map((e, i) => (
        <line
          key={`c${i}`}
          x1={X(e.a[0])}
          y1={Y(e.a[1])}
          x2={X(e.b[0])}
          y2={Y(e.b[1])}
          stroke={C.line}
          strokeWidth={e.role === 'column' ? 4 : 2.4}
          fill="none"
        />
      ))}
      {marksY.map((m, i) => (
        <g key={`lv${i}`}>
          <line x1={right + 8} y1={Y(m.y)} x2={right + 26} y2={Y(m.y)} stroke={C.thin} strokeWidth={0.9} fill="none" />
          <path d={`M${right + 20} ${Y(m.y)}l-5 -8h10z`} fill="none" stroke={C.ink} strokeWidth={1} />
          <Txt x={right + 30} y={Y(m.y) - 3} anchor="start" size={FS_S} mono fill={C.ink2}>
            {m.text}
          </Txt>
        </g>
      ))}
      {frames.map((x, i) => (g.shownAxes.has(i) ? <Bubble key={`bx${i}`} x={X(x)} y={ground + 58} label={String(i + 1)} /> : null))}
      {labels.render()}
    </Sheet>
  );
}

// ───────────────────────── таблица марок ─────────────────────────

export function MarksLegend({ block }: { block: BlockCalc }): ReactElement {
  const rows = block.structure.spec;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th>Марка</th>
            <th>Наименование</th>
            <th>Сечение</th>
            <th className="r">Длина, м</th>
            <th className="r">Кол-во</th>
            <th className="r">Масса ед., кг</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.mark}-${i}`}>
              <td className="num">{r.mark}</td>
              <td>{r.name}</td>
              <td>{r.section}</td>
              <td className="r">{r.length ? nf(r.length, 2) : '—'}</td>
              <td className="r">{r.family === 'plate' ? '—' : r.count}</td>
              <td className="r">{nf(r.massEach, r.family === 'plate' ? 0 : 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────── всё вместе ─────────────────────────

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </section>
  );
}

export function FrameSchemes({ block }: { block: BlockCalc }): ReactElement {
  const b = block.project.building;
  const last = b.width;
  const floor = <FloorFramingPlan block={block} />;
  const hasFloor = block.structure.elements.some((e) => e.role === 'floor');
  return (
    <div className="stack">
      <Part title="Схема расположения колонн и связей">
        <ColumnsPlan block={block} />
      </Part>
      <Part title="Схема расположения элементов покрытия">
        <RoofFramingPlan block={block} />
      </Part>
      <Part title={`Схема по ряду ${rowLetter(block, 0)}`}>
        <RowElevation block={block} row={0} />
      </Part>
      <Part title={`Схема по ряду ${rowLetter(block, last)}`}>
        <RowElevation block={block} row={last} />
      </Part>
      {hasFloor ? <Part title="Схема расположения балок перекрытия">{floor}</Part> : null}
      <Part title="Марки элементов">
        <MarksLegend block={block} />
      </Part>
    </div>
  );
}
