// Фасады (развёртки стен) с раскладкой панелей и перетаскиванием проёмов,
// план раскладки кровли, ведомости панелей и фасонных элементов.
// Размеры — в условных единицах листа шириной 1000; цвета — только из CSS-переменных.

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { BlockCalc } from '../domain/calc';
import { wallLength, type OpeningInstance } from '../domain/geometry';
import { WALL_OFFSET, type PanelPiece } from '../domain/panels';
import { CORE_LABEL } from '../domain/thermal';
import type { WallSide } from '../domain/types';
import { nf, num } from './format';

const W = 1000;
const FS = 14;
const FS_S = 12.5;
const MONO = 'var(--mono)';

const C = {
  line: 'var(--blue)',
  ink: 'var(--ink)',
  ink2: 'var(--ink-2)',
  thin: 'var(--ink-3)',
  accent: 'var(--accent)',
  soft: 'var(--surface-2)',
  paper: 'var(--surface)',
  glass: 'var(--blue-soft)',
  bad: 'var(--bad)',
};

const AXIS_LETTERS = 'АБВГДЕЖИКЛМНПРСТУФШЭЮЯ'.split('');
const axisLetter = (j: number) => AXIS_LETTERS[j] ?? `А${j - AXIS_LETTERS.length + 1}`;
const mm = (m: number) => String(Math.round(m * 1000));
const level = (v: number) => (Math.abs(v) < 5e-4 ? '0,000' : `${v > 0 ? '+' : '−'}${nf(Math.abs(v), 3)}`);
const DASHDOT = '14 4 2 4';
const KIND_LETTER = { gate: 'В', door: 'Д', window: 'О' } as const;
const KIND_NAME = { gate: 'Ворота', door: 'Дверь', window: 'Окно' } as const;
const snap = (v: number) => Math.round(v * 20) / 20;

const WALL_TITLE: Record<WallSide, string> = {
  front: 'торец по оси 1',
  back: 'торец по последней оси',
  left: 'продольная стена по оси А',
  right: 'продольная стена по крайней буквенной оси',
};

interface TxtProps {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  fill?: string;
  mono?: boolean;
  weight?: number;
  halo?: boolean;
}

function Txt({ x, y, children, size = FS, anchor = 'middle', fill = C.ink, mono, weight, halo }: TxtProps) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontFamily={mono ? MONO : 'inherit'}
      fontWeight={weight}
      textAnchor={anchor}
      fill={fill}
      stroke={halo ? C.paper : 'none'}
      strokeWidth={halo ? 3.5 : undefined}
      strokeLinejoin={halo ? 'round' : undefined}
      paintOrder={halo ? 'stroke' : undefined}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      {children}
    </text>
  );
}

function Tick({ x, y }: { x: number; y: number }) {
  return <line x1={x - 4} y1={y + 4} x2={x + 4} y2={y - 4} stroke={C.ink} strokeWidth={1.5} fill="none" />;
}

function Bubble({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={11} fill={C.paper} stroke={C.ink} strokeWidth={1.1} />
      <Txt x={x} y={y + 4.5} size={FS_S} weight={600}>
        {label}
      </Txt>
    </g>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="drawing">
      <p className="muted small" style={{ margin: '6px 4px' }}>
        {children}
      </p>
    </div>
  );
}

/** Оценка ширины подписи в единицах листа */
const textWidth = (s: string, size = FS_S) => s.length * size * 0.58;

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

interface DragState {
  key: string;
  id: string;
  index: number;
  window: boolean;
  w: number;
  h: number;
  /** смещение точки захвата от левого нижнего угла проёма, м */
  du: number;
  dv: number;
  lastU: number;
  lastSill: number;
}

interface FacadeProps {
  block: BlockCalc;
  wall: WallSide;
  onMove?: (openingId: string, index: number, u: number, sill?: number) => void;
}

export function FacadeDrawing({ block, wall, onMove }: FacadeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const frame = useRef(0);
  const pending = useRef<(() => void) | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  // актуальная геометрия листа для обработчиков указателя
  const view = useRef<{ x0: number; yBase: number; s: number; ext: number; len: number; top: (u: number) => number }>({ x0: 0, yBase: 0, s: 1, ext: 0, len: 1, top: () => 1 });

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const p = block.project;
  const b = p.building;
  const env = p.envelope;
  if (env.walls === 'none') return <Note>Навес без стен: фасад не оформляется, раскладка стеновых панелей не требуется.</Note>;
  if (b.openSides?.includes(wall)) return <Note>Сторона примыкания к основному зданию: стена не выполняется.</Note>;

  const pn = block.panels;
  const len = wallLength(b, wall);
  const long = wall === 'left' || wall === 'right';
  const wallT = env.walls === 'sandwich' ? env.wallThk / 1000 : 0.04;
  const ext = long ? WALL_OFFSET + wallT : WALL_OFFSET;
  const top = pn.wallTop[wall];
  const gableEnd = !long && b.roof === 'gable';
  const eave = Math.min(top(0), top(len));
  const peak = gableEnd ? top(b.width / 2) : Math.max(top(0), top(len));
  const pieces = pn.pieces.filter((q) => q.surface === wall);
  const openings = block.structure.openings.filter((o) => o.wall === wall);
  const stops = pn.stops[wall].filter((s) => s > 0.01 && s < len - 0.01);
  const allStops = [0, ...stops, len];

  // ── масштаб и поля ──
  const ML = 44;
  const MR = 118;
  const MT = 26;
  const total = len + 2 * ext;
  const s = Math.min((W - ML - MR) / total, 440 / peak);
  const x0 = ML + (W - ML - MR - total * s) / 2;
  const yBase = MT + peak * s;
  const X = (u: number) => x0 + (u + ext) * s;
  const Y = (v: number) => yBase - v * s;
  const H = yBase + 124;
  view.current = { x0, yBase, s, ext, len, top };

  const outline: [number, number][] = [
    [-ext, 0],
    [len + ext, 0],
    [len + ext, top(len + ext)],
    ...(gableEnd ? ([[b.width / 2, peak]] as [number, number][]) : []),
    [-ext, top(-ext)],
  ];
  const outlinePts = outline.map(([u, v]) => `${X(u)},${Y(v)}`).join(' ');

  // ── подписи проёмов без наложений ──
  const labelBoxes: Box[] = [];
  const openingBoxes: Box[] = openings.map((o) => ({ x1: X(o.u), x2: X(o.u + o.w), y1: Y(o.sill + o.h), y2: Y(o.sill) }));
  const labels = new Map<string, { x: number; y: number; text: string }>();
  openings.forEach((o, i) => {
    // одинаковые окна одной группы подписываются один раз, чтобы не загромождать фасад
    if (o.opening.kind === 'window' && o.index > 0) return;
    const text = `${KIND_LETTER[o.opening.kind]} ${num(o.w)}×${num(o.h)}${o.opening.kind === 'window' && o.opening.qty > 1 ? ` — ${o.opening.qty} шт.` : ''}`;
    const tw = textWidth(text) + 6;
    const box = openingBoxes[i];
    const cx = (box.x1 + box.x2) / 2;
    const candidates: { box: Box; y: number; inside: boolean }[] = [];
    if (box.x2 - box.x1 >= tw && box.y2 - box.y1 >= 20) {
      const cy = (box.y1 + box.y2) / 2;
      candidates.push({ box: { x1: cx - tw / 2, x2: cx + tw / 2, y1: cy - 8, y2: cy + 8 }, y: cy + 4.5, inside: true });
    }
    candidates.push({ box: { x1: cx - tw / 2, x2: cx + tw / 2, y1: box.y1 - 19, y2: box.y1 - 3 }, y: box.y1 - 6, inside: false });
    if (o.sill > 0.6) candidates.push({ box: { x1: cx - tw / 2, x2: cx + tw / 2, y1: box.y2 + 3, y2: box.y2 + 19 }, y: box.y2 + 15, inside: false });
    for (const c of candidates) {
      if (c.box.x1 < X(-ext) || c.box.x2 > X(len + ext) || c.box.y1 < MT - 12) continue;
      if (labelBoxes.some((q) => overlaps(q, c.box))) continue;
      if (!c.inside && openingBoxes.some((q, j) => j !== i && overlaps(q, c.box))) continue;
      labelBoxes.push(c.box);
      labels.set(`${o.opening.id}:${o.index}`, { x: cx, y: c.y, text });
      break;
    }
  });

  // ── марки осей ──
  const marks: { u: number; label: string }[] = [];
  if (long) {
    allStops.forEach((u, i) => marks.push({ u, label: String(i + 1) }));
  } else {
    const span = block.structure.spanLen;
    const n = Math.max(1, Math.round(len / span));
    for (let j = 0; j <= n; j++) marks.push({ u: Math.min(len, j * span), label: axisLetter(j) });
  }
  const minGap = marks.length > 1 ? ((marks[marks.length - 1].u - marks[0].u) / (marks.length - 1)) * s : 100;
  const every = Math.max(1, Math.ceil(26 / Math.max(minGap, 1)));
  const shownMarks = marks.filter((_, i) => i % every === 0 || i === marks.length - 1);

  // ── высотные отметки ──
  const levels: { v: number; text: string; y: number }[] = [{ v: 0, text: 'пол', y: 0 }];
  levels.push({ v: eave, text: 'верх стены', y: 0 });
  if (peak - eave > 0.05) levels.push({ v: peak, text: gableEnd ? 'конёк' : 'верх стены', y: 0 });
  levels.sort((a, c) => c.v - a.v);
  let prevY = -Infinity;
  for (const l of levels) {
    l.y = Math.max(Y(l.v), prevY + 17);
    prevY = l.y;
  }
  const xLev = X(len + ext) + 12;

  const cutCount = pieces.filter((q) => q.cut).length;
  const active = drag.current && dragKey ? openings.find((o) => `${o.opening.id}:${o.index}` === dragKey) : undefined;

  // ── перетаскивание ──
  const toMeters = (e: ReactPointerEvent): { u: number; v: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const g = view.current;
    return { u: (pt.x - g.x0) / g.s - g.ext, v: (g.yBase - pt.y) / g.s };
  };
  const onDown = (e: ReactPointerEvent<SVGGElement>, o: OpeningInstance) => {
    if (!onMove || e.button > 0) return;
    const m = toMeters(e);
    if (!m) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const key = `${o.opening.id}:${o.index}`;
    drag.current = { key, id: o.opening.id, index: o.index, window: o.opening.kind === 'window', w: o.w, h: o.h, du: m.u - o.u, dv: m.v - o.sill, lastU: o.u, lastSill: o.sill };
    setDragKey(key);
  };
  const onDrag = (e: ReactPointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || !onMove) return;
    const m = toMeters(e);
    if (!m) return;
    const g = view.current;
    const u = snap(Math.min(Math.max(m.u - d.du, 0), Math.max(0, g.len - d.w)));
    let sill = d.lastSill;
    if (d.window) {
      const limit = Math.min(g.top(u), g.top(u + d.w)) - d.h - 0.1;
      sill = snap(Math.min(Math.max(m.v - d.dv, 0), Math.max(0, limit)));
    }
    if (Math.abs(u - d.lastU) < 1e-6 && Math.abs(sill - d.lastSill) < 1e-6) return;
    d.lastU = u;
    d.lastSill = sill;
    // не чаще одного вызова за кадр: родитель пересчитывает весь расчёт
    pending.current = () => onMove(d.id, d.index, u, d.window ? sill : undefined);
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const run = pending.current;
        pending.current = null;
        run?.();
      });
    }
  };
  const onUp = (e: ReactPointerEvent<SVGGElement>) => {
    if (!drag.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
    setDragKey(null);
  };

  // идентификаторы уникальны и между корнями React (серверный рендер отдельных чертежей)
  const tag = `${uid}-${block.id || 'main'}-${wall}`;
  const hatch = `hatch-${tag}`;
  const clip = `clip-${tag}`;

  const renderOpening = (o: OpeningInstance) => {
    const key = `${o.opening.id}:${o.index}`;
    const x = X(o.u);
    const y = Y(o.sill + o.h);
    const w = o.w * s;
    const h = o.h * s;
    const kind = o.opening.kind;
    const onColumn = !(kind === 'window' && o.sill >= 2.5) && stops.some((st) => st > o.u + 0.05 && st < o.u + o.w - 0.05);
    const dragging = dragKey === key;
    const stroke = onColumn ? C.bad : C.accent;
    const label = labels.get(key);
    const title = `${KIND_NAME[kind]} ${num(o.w)}×${num(o.h)} м, привязка ${num(o.u)} м${kind === 'window' ? `, низ ${level(o.sill)}` : ''}${onColumn ? ' — попадает на колонну' : ''}`;
    const inner: ReactNode[] = [];
    if (kind === 'gate') {
      if (o.opening.subtype === 'swing') {
        inner.push(<line key="m" x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke={C.accent} strokeWidth={1} fill="none" />);
      } else {
        const rows = Math.max(2, Math.round(o.h / 0.5));
        for (let k = 1; k < rows; k++) {
          inner.push(<line key={k} x1={x} y1={y + (k * h) / rows} x2={x + w} y2={y + (k * h) / rows} stroke={C.accent} strokeWidth={0.6} strokeOpacity={0.55} fill="none" />);
        }
      }
    } else if (kind === 'door') {
      inner.push(<rect key="leaf" x={x + 2} y={y + 2} width={Math.max(0, w - 4)} height={Math.max(0, h - 2)} fill="none" stroke={C.accent} strokeWidth={0.6} strokeOpacity={0.6} />);
      inner.push(<line key="h" x1={x + w - 5} y1={y + h * 0.5} x2={x + w - 5} y2={y + h * 0.58} stroke={C.accent} strokeWidth={1.6} fill="none" />);
    } else {
      const n = Math.max(1, Math.round(o.w / (o.opening.subtype === 'vitrage' ? 1.2 : 1.5)));
      for (let k = 1; k < n; k++) inner.push(<line key={k} x1={x + (k * w) / n} y1={y} x2={x + (k * w) / n} y2={y + h} stroke={C.accent} strokeWidth={0.8} fill="none" />);
      if (o.opening.subtype === 'vitrage' && o.h > 2.4) inner.push(<line key="t" x1={x} y1={y + h * 0.28} x2={x + w} y2={y + h * 0.28} stroke={C.accent} strokeWidth={0.8} fill="none" />);
    }
    return (
      <g
        key={key}
        role="img"
        aria-label={title}
        style={onMove ? { cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' } : undefined}
        onPointerDown={onMove ? (e) => onDown(e, o) : undefined}
        onPointerMove={onMove ? onDrag : undefined}
        onPointerUp={onMove ? onUp : undefined}
        onPointerCancel={onMove ? onUp : undefined}
      >
        <title>{title}</title>
        <rect x={x} y={y} width={w} height={h} fill={kind === 'window' ? C.glass : C.soft} stroke={stroke} strokeWidth={dragging || onColumn ? 2.2 : 1.5} />
        {inner}
        {label ? (
          <Txt x={label.x} y={label.y} size={FS_S} fill={C.accent} halo>
            {label.text}
          </Txt>
        ) : null}
      </g>
    );
  };

  // подсказка с привязкой во время перетаскивания
  let hint: ReactNode = null;
  if (active) {
    const left = [...allStops].reverse().find((st) => st <= active.u + 1e-6) ?? 0;
    const lines = [`от оси: ${nf(active.u - left, 2)} м`];
    if (active.opening.kind === 'window') lines.push(`низ: ${level(active.sill).replace(/(\d),(\d\d)\d$/, '$1,$2')}`);
    const tw = Math.max(...lines.map((l) => textWidth(l))) + 14;
    const hx = Math.min(Math.max(X(active.u + active.w / 2) - tw / 2, 4), W - tw - 4);
    const above = Y(active.sill + active.h) - 8 - lines.length * 16;
    const hy = above > 4 ? above : Y(active.sill) + 8;
    hint = (
      <g style={{ pointerEvents: 'none' }}>
        <rect x={hx} y={hy} width={tw} height={lines.length * 16 + 6} rx={4} fill={C.paper} stroke={C.accent} strokeWidth={1} />
        {lines.map((l, i) => (
          <Txt key={l} x={hx + tw / 2} y={hy + 15 + i * 16} size={FS_S} mono>
            {l}
          </Txt>
        ))}
        <line x1={X(left)} y1={Y(0) + 6} x2={X(active.u)} y2={Y(0) + 6} stroke={C.accent} strokeWidth={1.2} fill="none" />
        <Tick x={X(left)} y={Y(0) + 6} />
        <Tick x={X(active.u)} y={Y(0) + 6} />
      </g>
    );
  }

  const yAxis = yBase + 34;
  const yDim = yBase + 66;
  const yCap = yBase + 96;

  return (
    <div className="drawing">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Фасад: ${WALL_TITLE[wall]}. Раскладка панелей и проёмы`}>
        <defs>
          <pattern id={hatch} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={7} stroke={C.thin} strokeWidth={1} strokeOpacity={0.55} />
          </pattern>
          <clipPath id={clip}>
            <polygon points={outlinePts} />
          </clipPath>
        </defs>

        {/* панели */}
        <g clipPath={`url(#${clip})`}>
          <polygon points={outlinePts} fill={C.paper} stroke="none" />
          {pieces.map((q: PanelPiece, i) => (
            <rect
              key={i}
              x={X(q.u)}
              y={Y(q.v + q.dv)}
              width={q.du * s}
              height={q.dv * s}
              fill={q.cut ? `url(#${hatch})` : C.soft}
              fillOpacity={q.cut ? 1 : 0.55}
              stroke={C.line}
              strokeWidth={0.6}
              strokeOpacity={0.75}
            />
          ))}
        </g>

        {/* оси и вертикальные стыки */}
        {allStops.map((u) => (
          <line key={`ax${u}`} x1={X(u)} y1={Y(top(u)) - 8} x2={X(u)} y2={yAxis - 11} stroke={C.thin} strokeWidth={0.8} strokeDasharray={DASHDOT} fill="none" />
        ))}
        {!pn.vertical
          ? stops.map((u) => <line key={`st${u}`} x1={X(u)} y1={Y(top(u))} x2={X(u)} y2={Y(0)} stroke={C.line} strokeWidth={2} fill="none" />)
          : null}

        {/* контур стены, цокольный отлив, уровень пола */}
        <polygon points={outlinePts} fill="none" stroke={C.line} strokeWidth={1.8} strokeLinejoin="round" />
        <line x1={X(-ext) - 3} y1={Y(0.12)} x2={X(len + ext) + 3} y2={Y(0.12)} stroke={C.line} strokeWidth={1.2} fill="none" />
        <line x1={X(-ext) - 22} y1={Y(0)} x2={X(len + ext) + 22} y2={Y(0)} stroke={C.ink} strokeWidth={1.6} fill="none" />

        {/* проёмы: перетаскиваемый рисуется последним, чтобы быть поверх соседних */}
        {openings.filter((o) => `${o.opening.id}:${o.index}` !== dragKey).map(renderOpening)}
        {openings.filter((o) => `${o.opening.id}:${o.index}` === dragKey).map(renderOpening)}

        {/* высотные отметки */}
        {levels.map((l) => (
          <g key={l.text + l.v}>
            <polyline points={`${X(len + ext) + 2},${Y(l.v)} ${xLev},${Y(l.v)} ${xLev + 8},${l.y} ${xLev + 100},${l.y}`} fill="none" stroke={C.thin} strokeWidth={0.9} />
            <Txt x={xLev + 12} y={l.y - 4} size={FS_S} anchor="start" mono>
              {level(l.v)}
            </Txt>
            <Txt x={xLev + 12} y={l.y + 12} size={11} anchor="start" fill={C.ink2}>
              {l.text}
            </Txt>
          </g>
        ))}

        {/* марки осей */}
        {shownMarks.map((m) => (
          <Bubble key={m.label} x={X(m.u)} y={yAxis} label={m.label} />
        ))}

        {/* общая длина стены */}
        <line x1={X(0)} y1={yAxis + 12} x2={X(0)} y2={yDim + 6} stroke={C.thin} strokeWidth={0.8} fill="none" />
        <line x1={X(len)} y1={yAxis + 12} x2={X(len)} y2={yDim + 6} stroke={C.thin} strokeWidth={0.8} fill="none" />
        <line x1={X(0) - 6} y1={yDim} x2={X(len) + 6} y2={yDim} stroke={C.thin} strokeWidth={0.9} fill="none" />
        <Tick x={X(0)} y={yDim} />
        <Tick x={X(len)} y={yDim} />
        <Txt x={(X(0) + X(len)) / 2} y={yDim - 5} size={FS_S} mono>
          {mm(len)}
        </Txt>

        {hint}

        <Txt x={ML} y={yCap} size={FS_S} anchor="start" fill={C.ink2}>
          {`Раскладка ${pn.vertical ? 'вертикальная' : 'горизонтальная'}, модуль ${mm(pn.module)} мм; панелей на стене: ${pieces.length}, из них с подрезкой: ${cutCount}`}
        </Txt>
        {onMove ? (
          <Txt x={ML} y={yCap + 18} size={11.5} anchor="start" fill={C.thin}>
            Проёмы можно перетаскивать мышью: по горизонтали — привязка, у окон по вертикали — отметка низа. Шаг 50 мм.
          </Txt>
        ) : null}
      </svg>
    </div>
  );
}

export function RoofLayoutDrawing({ block }: { block: BlockCalc }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const b = block.project.building;
  const pn = block.panels;
  const roof = pn.pieces.filter((q) => q.surface === 'roofA' || q.surface === 'roofB');
  if (!roof.length) return <Note>Раскладка кровли не рассчитана.</Note>;

  const cos = Math.cos((b.slopeDeg * Math.PI) / 180);
  const gable = b.roof === 'gable';
  const roofLen = Math.max(...roof.map((q) => q.u + q.du));
  const slope = Math.max(...roof.map((q) => q.v + q.dv));
  const slopePlan = slope * cos;
  const depth = gable ? 2 * slopePlan : slopePlan;
  const sideX = (roofLen - b.length) / 2;
  const sideZ = (depth - b.width) / 2;

  const ML = 60;
  const MR = 60;
  const MT = 34;
  const s = Math.min((W - ML - MR) / roofLen, 420 / depth);
  const x0 = ML + (W - ML - MR - roofLen * s) / 2;
  const yBot = MT + depth * s;
  const X = (u: number) => x0 + u * s;
  // z = 0 (ось А) — внизу чертежа, как на плане
  const Yz = (z: number) => yBot - z * s;
  const H = yBot + 62;

  // положение панели поперёк здания: roofA у двускатной — от карниза у оси А к коньку;
  // односкатная — карниз у противоположной стены (верх ската у оси А)
  const zRange = (q: PanelPiece): [number, number] => {
    const a = q.v * cos;
    const c = (q.v + q.dv) * cos;
    if (gable && q.surface === 'roofA') return [a, c];
    return [depth - c, depth - a];
  };

  const partsPerSlope = new Set(roof.filter((q) => q.surface === 'roofA').map((q) => q.v.toFixed(3))).size;
  const lengths = [...new Set(roof.map((q) => q.length))].sort((a, c) => c - a);
  const cut = roof.filter((q) => q.cut).length;
  const hatch = `rhatch-${uid}-${block.id || 'main'}`;
  const arrow = `rarrow-${uid}-${block.id || 'main'}`;
  const arrows: { x: number; z1: number; z2: number }[] = [];
  const xs = [0.25, 0.75].map((k) => X(roofLen * k));
  for (const x of xs) {
    if (gable) {
      arrows.push({ x, z1: depth / 2 - depth * 0.06, z2: depth / 2 - depth * 0.3 });
      arrows.push({ x, z1: depth / 2 + depth * 0.06, z2: depth / 2 + depth * 0.3 });
    } else {
      arrows.push({ x, z1: depth * 0.3, z2: depth * 0.7 });
    }
  }

  return (
    <div className="drawing">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="План кровли: раскладка кровельных панелей">
        <defs>
          <pattern id={hatch} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={7} stroke={C.thin} strokeWidth={1} strokeOpacity={0.55} />
          </pattern>
          <marker id={arrow} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={C.ink2} stroke="none" />
          </marker>
        </defs>

        {roof.map((q, i) => {
          const [z1, z2] = zRange(q);
          return (
            <rect
              key={i}
              x={X(q.u)}
              y={Yz(z2)}
              width={q.du * s}
              height={(z2 - z1) * s}
              fill={q.cut ? `url(#${hatch})` : C.soft}
              fillOpacity={q.cut ? 1 : 0.55}
              stroke={C.line}
              strokeWidth={0.6}
              strokeOpacity={0.75}
            />
          );
        })}

        {/* контур кровли и контур здания по осям */}
        <rect x={X(0)} y={Yz(depth)} width={roofLen * s} height={depth * s} fill="none" stroke={C.line} strokeWidth={1.8} />
        <rect x={X(sideX)} y={Yz(sideZ + b.width)} width={b.length * s} height={b.width * s} fill="none" stroke={C.thin} strokeWidth={0.9} strokeDasharray="6 4" />

        {gable ? (
          <>
            <line x1={X(0)} y1={Yz(depth / 2)} x2={X(roofLen)} y2={Yz(depth / 2)} stroke={C.accent} strokeWidth={2} fill="none" />
            <Txt x={X(roofLen / 2)} y={Yz(depth / 2) - 6} size={FS_S} fill={C.accent} halo>
              конёк
            </Txt>
          </>
        ) : (
          <Txt x={X(roofLen / 2)} y={Yz(0) - 7} size={FS_S} fill={C.accent} halo>
            верх ската
          </Txt>
        )}

        {arrows.map((a, i) => (
          <line key={i} x1={a.x} y1={Yz(a.z1)} x2={a.x} y2={Yz(a.z2)} stroke={C.ink2} strokeWidth={1.4} fill="none" markerEnd={`url(#${arrow})`} />
        ))}
        <Txt x={xs[0] + 8} y={Yz(gable ? depth * 0.2 : depth * 0.5)} size={FS_S} anchor="start" fill={C.ink2} halo>
          {`уклон ${num(b.slopeDeg)}°`}
        </Txt>

        {/* размеры кровли */}
        <line x1={X(0) - 6} y1={yBot + 22} x2={X(roofLen) + 6} y2={yBot + 22} stroke={C.thin} strokeWidth={0.9} fill="none" />
        <line x1={X(0)} y1={yBot + 4} x2={X(0)} y2={yBot + 28} stroke={C.thin} strokeWidth={0.8} fill="none" />
        <line x1={X(roofLen)} y1={yBot + 4} x2={X(roofLen)} y2={yBot + 28} stroke={C.thin} strokeWidth={0.8} fill="none" />
        <Tick x={X(0)} y={yBot + 22} />
        <Tick x={X(roofLen)} y={yBot + 22} />
        <Txt x={X(roofLen / 2)} y={yBot + 17} size={FS_S} mono>
          {mm(roofLen)}
        </Txt>
        <Txt x={X(0) - 10} y={(Yz(0) + Yz(depth)) / 2} size={FS_S} anchor="end" mono>
          {mm(depth)}
        </Txt>

        <Txt x={ML} y={yBot + 50} size={FS_S} anchor="start" fill={C.ink2}>
          {`Кровельных панелей: ${roof.length} шт., длина ${lengths.map((l) => nf(l, 2)).join(' и ')} м` +
            (partsPerSlope > 1 ? ` (по длине ската — из ${partsPerSlope === 2 ? 'двух' : partsPerSlope} частей с нахлёстом)` : '') +
            (cut ? `; с подрезкой по ширине: ${cut}` : '') +
            `. Модуль ${mm(pn.module)} мм, пунктир — здание по осям.`}
        </Txt>
      </svg>
    </div>
  );
}

export function PanelSchedule({ block }: { block: BlockCalc }) {
  const env = block.project.envelope;
  const pn = block.panels;
  const wallType = env.walls === 'sandwich' ? `Стеновая ${env.wallThk} мм, ${CORE_LABEL[env.wallCore]}` : 'Стеновой профлист';
  const roofType = env.roofing === 'sandwich' ? `Кровельная ${env.roofThk} мм, ${CORE_LABEL[env.roofCore]}` : 'Кровельный профлист';
  const walls = pn.groups.filter((g) => g.kind === 'wall');
  const roofs = pn.groups.filter((g) => g.kind === 'roof');
  const sumCut = (list: typeof pn.groups) => list.reduce((a, g) => a + g.cut, 0);

  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Ведомость панелей</th>
              <th className="r">Длина, м</th>
              <th className="r">Кол-во</th>
              <th className="r">С подрезкой</th>
              <th className="r">Площадь, м²</th>
            </tr>
          </thead>
          <tbody>
            {walls.map((g) => (
              <tr key={`w${g.length}`}>
                <td>{wallType}</td>
                <td className="r">{nf(g.length, 2)}</td>
                <td className="r">{g.count}</td>
                <td className="r">{g.cut || '—'}</td>
                <td className="r">{nf(g.area, 1)}</td>
              </tr>
            ))}
            {walls.length ? (
              <tr className="sec">
                <td colSpan={2}>Итого стены</td>
                <td className="r">{pn.wallCount}</td>
                <td className="r">{sumCut(walls) || '—'}</td>
                <td className="r">{nf(pn.wallArea, 1)}</td>
              </tr>
            ) : null}
            {roofs.map((g) => (
              <tr key={`r${g.length}`}>
                <td>{roofType}</td>
                <td className="r">{nf(g.length, 2)}</td>
                <td className="r">{g.count}</td>
                <td className="r">{g.cut || '—'}</td>
                <td className="r">{nf(g.area, 1)}</td>
              </tr>
            ))}
            <tr className="sec">
              <td colSpan={2}>Итого кровля</td>
              <td className="r">{pn.roofCount}</td>
              <td className="r">{sumCut(roofs) || '—'}</td>
              <td className="r">{nf(pn.roofArea, 1)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Площадь заказная: модуль {mm(pn.module)} мм × длина панели. Панели с подрезкой режутся по месту: по скату, по высоте или под проём.
      </p>

      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Фасонные элементы</th>
              <th className="r">Длина, м.п.</th>
              <th className="r">Планок по 3 м</th>
              <th>Где применяется</th>
            </tr>
          </thead>
          <tbody>
            {pn.trims.map((t) => (
              <tr key={t.priceId}>
                <td>{t.name}</td>
                <td className="r">{nf(t.length, 1)}</td>
                <td className="r">{t.pieces}</td>
                <td className="wrap">{t.where}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Всего</td>
              <td className="r">{nf(pn.trimLength, 1)}</td>
              <td className="r">{pn.trims.reduce((a, t) => a + t.pieces, 0)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
