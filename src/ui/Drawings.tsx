// Чертежи для экрана и печатных документов: план в осях и поперечный разрез по рядовой раме.
// Все размеры в условных единицах листа шириной 1000; цвета — только из CSS-переменных,
// чтобы чертёж одинаково читался в светлой и тёмной теме и на «бумаге» КП.

import type { ReactNode } from 'react';
import type { CalcResult } from '../domain/calc';
import { roofRise, type OpeningInstance } from '../domain/geometry';
import type { Project, WallSide } from '../domain/types';
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
};

/** Буквенные оси по ГОСТ: без З, Й, О, Х, Ц, Ч, Щ, Ъ, Ы, Ь */
const AXIS_LETTERS = 'АБВГДЕЖИКЛМНПРСТУФШЭЮЯ'.split('');
const axisLetter = (j: number) => AXIS_LETTERS[j] ?? `А${j - AXIS_LETTERS.length + 1}`;

const mm = (m: number) => String(Math.round(m * 1000));
const level = (v: number) => (Math.abs(v) < 5e-4 ? '0,000' : `${v > 0 ? '+' : '−'}${nf(Math.abs(v), 3)}`);
const DASHDOT = '14 4 2 4';

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
  /** подложка цвета листа, чтобы подпись читалась поверх линий */
  halo?: boolean;
}

function Txt({ x, y, children, size = FS, anchor = 'middle', fill = C.ink, mono, rotate, weight, halo }: TxtProps) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontFamily={mono ? MONO : 'inherit'}
      fontWeight={weight}
      textAnchor={anchor}
      fill={fill}
      stroke={halo ? 'var(--surface)' : 'none'}
      strokeWidth={halo ? 3.5 : undefined}
      strokeLinejoin={halo ? 'round' : undefined}
      paintOrder={halo ? 'stroke' : undefined}
      transform={rotate ? `rotate(-90 ${x} ${y})` : undefined}
    >
      {children}
    </text>
  );
}

function Tick({ x, y }: { x: number; y: number }) {
  return <line x1={x - 4} y1={y + 4} x2={x + 4} y2={y - 4} stroke={C.ink} strokeWidth={1.5} fill="none" />;
}

/** Горизонтальная размерная цепочка. labels[i] — подпись участка i; single — одна подпись на всю цепочку */
function DimH({ xs, y, yFrom, labels, single }: { xs: number[]; y: number; yFrom: number; labels?: string[]; single?: string }) {
  const a = xs[0];
  const b = xs[xs.length - 1];
  return (
    <g>
      {xs.map((x, i) => (
        <line key={`e${i}`} x1={x} y1={yFrom} x2={x} y2={y + 6} stroke={C.thin} strokeWidth={0.8} fill="none" />
      ))}
      <line x1={a - 6} y1={y} x2={b + 6} y2={y} stroke={C.thin} strokeWidth={0.9} fill="none" />
      {xs.map((x, i) => (
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

/** Вертикальная размерная цепочка (подписи повёрнуты) */
function DimV({ ys, x, xFrom, labels, single }: { ys: number[]; x: number; xFrom: number; labels?: string[]; single?: string }) {
  const a = ys[0];
  const b = ys[ys.length - 1];
  return (
    <g>
      {ys.map((y, i) => (
        <line key={`e${i}`} x1={xFrom} y1={y} x2={x - 6} y2={y} stroke={C.thin} strokeWidth={0.8} fill="none" />
      ))}
      <line x1={x} y1={Math.min(a, b) - 6} x2={x} y2={Math.max(a, b) + 6} stroke={C.thin} strokeWidth={0.9} fill="none" />
      {ys.map((y, i) => (
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

function Bubble({ x, y, label, r = 11 }: { x: number; y: number; label: string; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="none" stroke={C.ink2} strokeWidth={1.1} />
      <Txt x={x} y={y + FS_S * 0.36} size={label.length > 2 ? 10 : FS_S} weight={600}>
        {label}
      </Txt>
    </g>
  );
}

const KIND_LETTER = { gate: 'В', door: 'Д', window: 'О' } as const;

// ───────────────────────── план ─────────────────────────

export function PlanDrawing({ project, calc }: { project: Project; calc: CalcResult }) {
  const b = project.building;
  const st = calc.structure;
  const L = Math.max(b.length, 0.5);
  const B = Math.max(b.width, 0.5);
  const nSpans = Math.max(1, b.spans);
  const Ls = B / nSpans;
  const frames = st.frames.length >= 2 ? st.frames : [0, L];
  const bays = frames.length - 1;
  const hasWalls = project.envelope.walls !== 'none';

  const ML = 112;
  const MR = 34;
  const MT = 34;
  const avail = W - ML - MR;
  const s = Math.min(avail / L, 520 / B, 70);
  const x0 = ML + (avail - L * s) / 2;
  const y0 = MT;
  const X = (x: number) => x0 + x * s;
  const Y = (z: number) => y0 + (B - z) * s;
  const yb = Y(0);
  const xr = X(L);

  // нижние и левые размерные цепочки
  const stepLabel = mm(L / bays);
  const stepFits = (L / bays) * s >= stepLabel.length * FS_S * 0.62 + 8;
  const yChain = yb + 32;
  const yTotal = bays > 1 ? yb + 58 : yChain;
  const yBub = yTotal + 32;
  const xChain = x0 - 32;
  const xTotal = nSpans > 1 ? x0 - 58 : xChain;
  const xBub = xTotal - 32;
  const H = yBub + 11 + 34;

  // прореживание марок цифровых осей, если они слипаются
  const spacing = (L / bays) * s;
  const every = Math.max(1, Math.ceil(26 / Math.max(spacing, 1)));

  // стены: полоса снаружи осей
  const o1 = Math.max(0.12 * s, 3);
  const tw = Math.max((project.envelope.wallThk / 1000) * s, 3.2);
  interface WallDef {
    side: WallSide;
    len: number;
    base(u: number): [number, number];
    /** вдоль стены и внутрь здания, в координатах листа */
    a: [number, number];
    n: [number, number];
    ext: number;
  }
  const walls: WallDef[] = [
    { side: 'left', len: L, base: (u) => [X(u), Y(0)], a: [1, 0], n: [0, -1], ext: (o1 + tw) / s },
    { side: 'right', len: L, base: (u) => [X(u), Y(B)], a: [1, 0], n: [0, 1], ext: (o1 + tw) / s },
    { side: 'front', len: B, base: (u) => [X(0), Y(u)], a: [0, -1], n: [1, 0], ext: o1 / s },
    { side: 'back', len: B, base: (u) => [X(L), Y(u)], a: [0, -1], n: [-1, 0], ext: o1 / s },
  ];
  const openings: OpeningInstance[] = hasWalls ? st.openings : [];
  const pt = (w: WallDef, u: number, d: number): [number, number] => {
    const p = w.base(u);
    return [p[0] - w.n[0] * d, p[1] - w.n[1] * d];
  };
  const P = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

  const wallEls: ReactNode[] = [];
  const openEls: ReactNode[] = [];
  if (hasWalls) {
    for (const w of walls) {
      const items = openings
        .filter((o) => o.wall === w.side)
        .map((o) => ({ o, u1: Math.max(0, o.u), u2: Math.min(w.len, o.u + o.w) }))
        .filter((q) => q.u2 > q.u1)
        .sort((q1, q2) => q1.u1 - q2.u1);
      // сплошные участки стены между проёмами
      let cur = -w.ext;
      const segs: [number, number][] = [];
      for (const q of items) {
        if (q.u1 > cur) segs.push([cur, q.u1]);
        cur = Math.max(cur, q.u2);
      }
      if (w.len + w.ext > cur) segs.push([cur, w.len + w.ext]);
      segs.forEach(([u1, u2], i) => {
        wallEls.push(
          <polygon
            key={`${w.side}-s${i}`}
            points={[pt(w, u1, o1), pt(w, u2, o1), pt(w, u2, o1 + tw), pt(w, u1, o1 + tw)].map(P).join(' ')}
            fill={C.soft}
            stroke={C.line}
            strokeWidth={1.1}
          />,
        );
      });

      const labelled = new Set<string>();
      const labelReqs: { kind: 'gate' | 'door' | 'window'; u1: number; u2: number; text: string }[] = [];
      items.forEach(({ o, u1, u2 }, i) => {
        const key = `${w.side}-o${i}`;
        const kind = o.opening.kind;
        const c = o1 + tw / 2;
        const parts: ReactNode[] = [];
        if (kind === 'gate') {
          const [p1, p2] = [pt(w, u1, c), pt(w, u2, c)];
          parts.push(<line key="g" x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke={C.accent} strokeWidth={Math.max(tw * 0.7, 3.5)} fill="none" />);
        } else if (kind === 'window') {
          for (const d of [o1, c, o1 + tw]) {
            const [p1, p2] = [pt(w, u1, d), pt(w, u2, d)];
            parts.push(<line key={`w${d}`} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke={C.line} strokeWidth={0.9} fill="none" />);
          }
        } else {
          // дверь: полотно открыто внутрь, дуга от конца полотна к притвору
          const r = (u2 - u1) * s;
          const hinge = pt(w, u1, o1);
          const tip: [number, number] = [hinge[0] + w.n[0] * r, hinge[1] + w.n[1] * r];
          const end = pt(w, u2, o1);
          const sweep = Math.abs(-w.n[1] - w.a[0]) < 1e-6 && Math.abs(w.n[0] - w.a[1]) < 1e-6 ? 1 : 0;
          parts.push(<line key="d" x1={hinge[0]} y1={hinge[1]} x2={tip[0]} y2={tip[1]} stroke={C.accent} strokeWidth={1.6} fill="none" />);
          parts.push(<path key="a" d={`M ${P(tip)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${sweep} ${P(end)}`} stroke={C.accent} strokeWidth={0.9} fill="none" />);
        }
        // откосы проёма
        for (const u of [u1, u2]) {
          const [p1, p2] = [pt(w, u, o1), pt(w, u, o1 + tw)];
          parts.push(<line key={`j${u}`} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke={kind === 'window' ? C.line : C.accent} strokeWidth={1.1} fill="none" />);
        }
        // подпись: окна и многочисленные двери — только первые в ряду; одинаковые окна — один раз на стену
        const text = `${KIND_LETTER[kind]} ${num(o.w)}×${num(o.h)}`;
        const idKey = kind === 'window' ? text : `${o.opening.id}`;
        const many = kind === 'window' || (kind === 'door' && o.opening.qty > 3);
        if (!many || !labelled.has(idKey)) {
          labelled.add(idKey);
          labelReqs.push({ kind, u1, u2, text });
        }
        openEls.push(<g key={key}>{parts}</g>);
      });

      // расстановка подписей вдоль стены без наложений: сначала ворота и двери, затем окна
      const horizontal = w.a[0] !== 0;
      const prio = { gate: 0, door: 1, window: 2 } as const;
      const taken: [number, number][] = items
        .filter((q) => q.o.opening.kind === 'door')
        .map((q) => (horizontal ? [X(q.u1) - 2, X(q.u2) + 2] : [Y(q.u2) - 2, Y(q.u1) + 2]));
      [...labelReqs]
        .sort((q1, q2) => prio[q1.kind] - prio[q2.kind] || q1.u1 - q2.u1)
        .forEach((q, i) => {
          const fill = q.kind === 'window' ? C.ink2 : C.accent;
          const key = `${w.side}-t${i}`;
          if (horizontal) {
            const width = q.text.length * FS_S * 0.58;
            let x1 = q.kind === 'door' ? X(q.u2) + 6 : X((q.u1 + q.u2) / 2) - width / 2;
            for (let k = 0; k < 6; k++) {
              const hit = taken.find((t) => x1 < t[1] && x1 + width > t[0]);
              if (!hit) break;
              x1 = hit[1] + 6;
            }
            const clash = (x: number) => x + width > xr - 4 || x < x0 + 4 || taken.some((t) => x < t[1] && x + width > t[0]);
            // не поместилась справа — пробуем слева от проёма
            if (clash(x1)) x1 = X(q.u1) - 6 - width;
            if (clash(x1)) return;
            taken.push([x1 - 4, x1 + width + 4]);
            const yw = w.base(0)[1];
            const ty = w.n[1] < 0 ? yw - 9 : yw + 9 + FS_S * 0.75;
            openEls.push(
              <Txt key={key} x={x1} y={ty} size={FS_S} anchor="start" fill={fill} halo>
                {q.text}
              </Txt>,
            );
          } else {
            // вертикальная стена: подписи горизонтальные, разносим по высоте листа
            let ty = q.kind === 'door' ? Y(q.u2) - 6 : Y((q.u1 + q.u2) / 2) + FS_S * 0.36;
            for (let k = 0; k < 6; k++) {
              const hit = taken.find((t) => ty - FS_S < t[1] && ty + 3 > t[0]);
              if (!hit) break;
              ty = hit[0] - 5;
            }
            if (ty - FS_S < y0 + 2) return;
            taken.push([ty - FS_S - 2, ty + 5]);
            const xw = w.base(0)[0];
            openEls.push(
              <Txt key={key} x={xw + w.n[0] * 11} y={ty} size={FS_S} anchor={w.n[0] > 0 ? 'start' : 'end'} fill={fill} halo>
                {q.text}
              </Txt>,
            );
          }
        });
    }
  }

  // зона перекрытий
  const floorLen = b.floors > 1 ? Math.min(L, b.floorLength ?? L) : 0;
  const floorLevels = b.floors > 1 ? Array.from({ length: b.floors - 1 }, (_, i) => ((i + 1) * b.height) / b.floors) : [];

  const crane = project.frame.crane;
  const colSize = Math.min(Math.max(0.3 * s, 7), 13);
  const postSize = Math.min(Math.max(0.2 * s, 5), 9);

  return (
    <div className="drawing">
      <svg viewBox={`0 0 ${W} ${H.toFixed(0)}`} role="img" aria-label={`План здания в осях, ${num(B)}×${num(L)} м`}>
        {/* оси */}
        {frames.map((x, i) => (
          <line key={`ax${i}`} x1={X(x)} y1={y0 - 14} x2={X(x)} y2={yBub - 11} stroke={C.thin} strokeWidth={0.8} strokeDasharray={DASHDOT} fill="none" />
        ))}
        {Array.from({ length: nSpans + 1 }, (_, j) => (
          <line key={`az${j}`} x1={xBub + 11} y1={Y(j * Ls)} x2={xr + 16} y2={Y(j * Ls)} stroke={C.thin} strokeWidth={0.8} strokeDasharray={DASHDOT} fill="none" />
        ))}

        {/* перекрытия */}
        {floorLen > 0 ? (
          <g>
            <rect x={X(0) + 5} y={Y(B) + 5} width={Math.max(4, floorLen * s - 10)} height={Math.max(4, B * s - 10)} fill="none" stroke={C.ink2} strokeWidth={1} strokeDasharray="7 5" />
            {(() => {
              const text = `Перекрытие на отм. ${floorLevels.map(level).join('; ')}`;
              const fits = floorLen * s - 24 >= text.length * FS_S * 0.56;
              // подпись в середине верхнего пролёта: там нет осевых линий
              const ty = Y(B - Ls / 2) + (nSpans === 1 ? -Math.min(22, B * s * 0.2) : FS_S * 0.36);
              return (
                <Txt x={fits ? X(floorLen / 2) : X(0) + 14} y={ty} size={FS_S} anchor={fits ? 'middle' : 'start'} fill={C.ink2} halo>
                  {text}
                </Txt>
              );
            })()}
          </g>
        ) : null}

        {/* подкрановые пути */}
        {crane.type === 'bridge'
          ? Array.from({ length: nSpans }, (_, j) => (
              <g key={`cr${j}`}>
                {[j * Ls + 0.6, (j + 1) * Ls - 0.6].map((z, k) => (
                  <line key={k} x1={X(0)} y1={Y(z)} x2={X(L)} y2={Y(z)} stroke={C.accent} strokeWidth={1.1} strokeDasharray={DASHDOT} fill="none" />
                ))}
                {j === 0 ? (
                  <Txt x={X(L / 2)} y={Y(Ls - 0.6) + FS_S + 4} size={FS_S} fill={C.accent} halo>
                    {`Кран-балка ${num(crane.capacity)} т`}
                  </Txt>
                ) : null}
              </g>
            ))
          : null}

        {/* стены и проёмы */}
        {wallEls}
        {openEls}

        {/* колонны */}
        {st.columns.map((c, i) => {
          const main = c.cls === 'outer' || c.cls === 'inner';
          const sz = main ? colSize : postSize;
          return (
            <rect
              key={`c${i}`}
              x={X(c.x) - sz / 2}
              y={Y(c.z) - sz / 2}
              width={sz}
              height={sz}
              fill={main ? C.line : 'none'}
              stroke={C.line}
              strokeWidth={main ? 0.8 : 1.3}
            />
          );
        })}

        {/* размеры */}
        {bays > 1 ? (
          <DimH
            xs={frames.map(X)}
            y={yChain}
            yFrom={yb + o1 + tw + 4}
            labels={stepFits ? frames.slice(1).map(() => stepLabel) : undefined}
            single={stepFits ? undefined : `${bays} × ${stepLabel}`}
          />
        ) : null}
        <DimH xs={[X(0), X(L)]} y={yTotal} yFrom={bays > 1 ? yChain + 8 : yb + o1 + tw + 4} labels={[mm(L)]} />
        {nSpans > 1 ? (
          <DimV ys={Array.from({ length: nSpans + 1 }, (_, j) => Y(j * Ls))} x={xChain} xFrom={x0 - o1 - tw - 4} labels={Array.from({ length: nSpans }, () => mm(Ls))} />
        ) : null}
        <DimV ys={[Y(0), Y(B)]} x={xTotal} xFrom={nSpans > 1 ? xChain - 8 : x0 - o1 - tw - 4} labels={[mm(B)]} />

        {/* марки осей */}
        {frames.map((x, i) =>
          i % every === 0 || i === frames.length - 1 ? (
            i !== frames.length - 1 && frames.length - 1 - i < every && every > 1 ? null : <Bubble key={`bx${i}`} x={X(x)} y={yBub} label={String(i + 1)} />
          ) : null,
        )}
        {Array.from({ length: nSpans + 1 }, (_, j) => (
          <Bubble key={`bz${j}`} x={xBub} y={Y(j * Ls)} label={axisLetter(j)} />
        ))}

        <Txt x={x0} y={H - 10} anchor="start" size={FS_S} fill={C.ink2}>
          План на отм. 0,000. Размеры в мм.
        </Txt>
      </svg>
    </div>
  );
}

// ───────────────────────── разрез ─────────────────────────

export function SectionDrawing({ project, calc }: { project: Project; calc: CalcResult }) {
  const b = project.building;
  const st = calc.structure;
  const geo = calc.geo;
  const env = project.envelope;
  const B = Math.max(b.width, 0.5);
  const Hh = b.height;
  const nSpans = Math.max(1, b.spans);
  const Ls = B / nSpans;
  const hasWalls = env.walls !== 'none';
  const members = st.section2d.members;

  const alpha = (b.slopeDeg * Math.PI) / 180;
  const cos = Math.cos(alpha) || 1;
  const ov = geo.overhang;
  const roofThk = env.roofing === 'proflist' ? 0.06 : env.roofThk / 1000;
  const tv = roofThk / cos;
  const wallThk = hasWalls ? Math.max(env.wallThk / 1000, 0.05) : 0;
  const e = 0.12;
  const under = (z: number) => geo.eaveHeight + roofRise(b, z);
  const ridgeZ = b.roof === 'gable' ? B / 2 : 0;
  const roofTop = under(ridgeZ) + tv;
  const topY = Math.max(roofTop, ...members.map((m) => Math.max(m.y1, m.y2)), 1);

  const ML = 56;
  const MR = 196;
  const MT = 40;
  const avail = W - ML - MR;
  const side = ov + e + wallThk + 0.2;
  const s = Math.min(avail / (B + 2 * side), 380 / topY, 130);
  const x0 = ML + (avail - B * s) / 2;
  const yG = MT + topY * s;
  const X = (z: number) => x0 + z * s;
  const Y = (y: number) => yG - y * s;

  // кровля: полоса над прогонами со свесами
  const zs = b.roof === 'gable' ? [-ov, B / 2, B + ov] : [-ov, B + ov];
  const roofPts = [...zs.map((z) => [X(z), Y(under(z))]), ...[...zs].reverse().map((z) => [X(z), Y(under(z) + tv)])];

  // отметки
  const levels: { y: number; label: string; from: number }[] = [{ y: 0, label: 'пол', from: B + side }];
  if (b.floors > 1) for (let i = 1; i < b.floors; i++) levels.push({ y: (i * Hh) / b.floors, label: 'перекрытие', from: B });
  levels.push({ y: Hh, label: 'низ конструкций', from: B });
  if (hasWalls) levels.push({ y: geo.eaveHeight, label: 'карниз', from: B + e + wallThk });
  levels.push({ y: roofTop, label: 'верх кровли', from: ridgeZ });
  levels.sort((a, c) => c.y - a.y);
  const xm = X(B + side) + 22;
  let prev = -Infinity;
  const marks = levels.map((lv) => {
    const yt = Y(lv.y);
    const ty = Math.max(yt, prev + 18);
    prev = ty;
    return { ...lv, yt, ty };
  });
  // если подписи «уехали» ниже нулевой отметки — поднимаем весь столбец
  const overflow = marks.length ? marks[marks.length - 1].ty - yG : 0;
  if (overflow > 0) for (const m of marks) m.ty -= overflow;

  // размеры и оси
  const yChain = yG + 44;
  const yTotal = nSpans > 1 ? yG + 70 : yChain;
  const yBub = yTotal + 32;

  // кран
  const crane = project.frame.crane;
  const drop = crane.capacity <= 5 ? 1.4 : crane.capacity <= 10 ? 1.7 : 2.1;
  const craneLevel = Math.max(Hh - drop, 0.6 * Hh);

  // легенда сечений
  const g = (key: string) => st.groups.find((x) => x.key === key);
  const legend: [string, string][] = [];
  const co = g('colOuter');
  const ci = g('colInner');
  if (co) legend.push(['К1 — колонны крайних рядов', co.section]);
  if (ci) legend.push(['К2 — колонны средних рядов', ci.section]);
  const raf = g('rafter');
  if (raf) legend.push(['Б1 — ригели рам', raf.section]);
  const tc = g('topChord');
  const bc = g('botChord');
  if (tc) legend.push(['Ферма, верхний пояс', tc.section]);
  if (bc) legend.push(['Ферма, нижний пояс', bc.section]);
  const ws = g('webSup');
  const wb = g('web');
  if (ws || wb) {
    const names = [ws?.section, wb?.section].filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i);
    legend.push(['Ферма, решётка', names.map((n, i) => (i ? n.replace('Труба ', '') : n)).join(' / ')]);
  }
  const fbm = g('floorBeam');
  if (fbm) legend.push(['БП1 — балки перекрытия', fbm.section]);
  const pur = st.secondary.find((x) => x.key === 'purlin');
  if (pur) legend.push(['П1 — прогоны', `${pur.section}, шаг рам ${num(st.step, 2)} м`]);
  if (crane.type !== 'none') {
    legend.push([crane.type === 'bridge' ? 'Кран-балка опорная' : 'Кран-балка подвесная', `${num(crane.capacity)} т${nSpans > 1 ? ' в каждом пролёте' : ''}`]);
  }
  const rows = Math.ceil(legend.length / 2);
  const yLeg = yBub + 11 + 30;
  const H = yLeg + rows * 19 + 12;

  const strokeOf: Record<string, number> = { column: 4.2, truss: 3.2, rafter: 4.2, web: 1.5, floor: 3.2 };
  const colZs = Array.from({ length: nSpans + 1 }, (_, j) => j * Ls);
  const baseZs = [...new Set(members.filter((m) => m.role === 'column' && Math.min(m.y1, m.y2) < 1e-6).map((m) => +(m.y1 < m.y2 ? m.z1 : m.z2).toFixed(3)))];
  const gx1 = X(-side) - 26;
  const gx2 = X(B + side) + 12;
  const hatch: number[] = [];
  for (let x = gx1 + 6; x < gx2; x += 13) hatch.push(x);

  return (
    <div className="drawing">
      <svg viewBox={`0 0 ${W} ${H.toFixed(0)}`} role="img" aria-label={`Поперечный разрез по рядовой раме, ширина ${num(B)} м, высота ${num(Hh)} м`}>
        <Txt x={ML - 30} y={20} anchor="start" size={FS_S} fill={C.ink2}>
          Разрез 1–1 по рядовой раме
        </Txt>

        {/* оси колонн */}
        {colZs.map((z, j) => (
          <line key={`ax${j}`} x1={X(z)} y1={Y(topY) - 12} x2={X(z)} y2={yBub - 11} stroke={C.thin} strokeWidth={0.8} strokeDasharray={DASHDOT} fill="none" />
        ))}

        {/* грунт и фундаменты */}
        <line x1={gx1} y1={yG} x2={gx2} y2={yG} stroke={C.ink} strokeWidth={1.4} fill="none" />
        {hatch.map((x, i) => (
          <line key={`h${i}`} x1={x} y1={yG + 1} x2={x - 7} y2={yG + 9} stroke={C.thin} strokeWidth={0.8} fill="none" />
        ))}
        {baseZs.map((z, i) => (
          <rect key={`f${i}`} x={X(z) - 12} y={yG + 1} width={24} height={14} fill={C.soft} stroke={C.ink2} strokeWidth={1} />
        ))}

        {/* ограждение */}
        <polygon points={roofPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} fill={C.soft} stroke={C.ink2} strokeWidth={1.1} />
        {hasWalls
          ? [
              { z1: -e - wallThk, z2: -e, top: under(0) },
              { z1: B + e, z2: B + e + wallThk, top: under(B) },
            ].map((w, i) => (
              <rect
                key={`w${i}`}
                x={X(w.z1) - (wallThk * s < 2.5 ? (2.5 - wallThk * s) / 2 : 0)}
                y={Y(w.top)}
                width={Math.max(wallThk * s, 2.5)}
                height={Math.max(1, yG - Y(w.top))}
                fill={C.soft}
                stroke={C.ink2}
                strokeWidth={1.1}
              />
            ))
          : null}

        {/* стержни рамы */}
        {members.map((m, i) => (
          <line
            key={`m${i}`}
            x1={X(m.z1)}
            y1={Y(m.y1)}
            x2={X(m.z2)}
            y2={Y(m.y2)}
            stroke={C.line}
            strokeWidth={strokeOf[m.role] ?? 2}
            strokeLinecap="round"
            fill="none"
          />
        ))}

        {/* кран */}
        {crane.type === 'bridge'
          ? Array.from({ length: nSpans }, (_, j) => {
              const zA = j * Ls;
              const zB = zA + Ls;
              const hb = Math.max(0.35 * s, 7);
              const yRail = Y(craneLevel + 0.25);
              const zh = zA + Ls * 0.36;
              return (
                <g key={`cr${j}`}>
                  {[zA, zB].map((z, k) => {
                    const dir = k === 0 ? 1 : -1;
                    return (
                      <g key={k}>
                        <line x1={X(z)} y1={Y(craneLevel)} x2={X(z + dir * 0.75)} y2={Y(craneLevel)} stroke={C.line} strokeWidth={3} fill="none" />
                        <rect x={X(z + dir * 0.6) - 3.5} y={yRail} width={7} height={Math.max(2, Y(craneLevel) - yRail)} fill={C.line} stroke={C.line} strokeWidth={0.5} />
                      </g>
                    );
                  })}
                  <rect x={X(zA + 0.45)} y={yRail - hb} width={Math.max(4, (Ls - 0.9) * s)} height={hb} fill="none" stroke={C.accent} strokeWidth={1.5} />
                  <rect x={X(zh) - 7} y={yRail - 2} width={14} height={6} fill={C.accent} stroke={C.accent} strokeWidth={0.5} />
                  <line x1={X(zh)} y1={yRail + 4} x2={X(zh)} y2={yRail + 4 + Math.max(0.9 * s, 16)} stroke={C.accent} strokeWidth={1.1} fill="none" />
                  <circle cx={X(zh)} cy={yRail + 7 + Math.max(0.9 * s, 16)} r={3} fill="none" stroke={C.accent} strokeWidth={1.1} />
                  <Txt x={X(zh) + 9} y={yRail + 20} anchor="start" size={FS_S} fill={C.accent} halo>
                    {`${num(crane.capacity)} т`}
                  </Txt>
                </g>
              );
            })
          : null}
        {crane.type === 'suspended'
          ? Array.from({ length: nSpans }, (_, j) => {
              const zA = j * Ls;
              const a = Math.max(1.2, 0.12 * Ls);
              const yc = Y(Hh - 0.35);
              const zh = zA + Ls * 0.36;
              return (
                <g key={`cs${j}`}>
                  {[zA + a, zA + Ls - a].map((z, k) => (
                    <line key={k} x1={X(z)} y1={Y(Hh)} x2={X(z)} y2={yc} stroke={C.accent} strokeWidth={1.5} fill="none" />
                  ))}
                  <rect x={X(zA + a) - 6} y={yc} width={Math.max(4, (Ls - 2 * a) * s + 12)} height={Math.max(0.2 * s, 5)} fill="none" stroke={C.accent} strokeWidth={1.5} />
                  <line x1={X(zh)} y1={yc + 5} x2={X(zh)} y2={yc + 5 + Math.max(0.8 * s, 14)} stroke={C.accent} strokeWidth={1.1} fill="none" />
                  <circle cx={X(zh)} cy={yc + 8 + Math.max(0.8 * s, 14)} r={3} fill="none" stroke={C.accent} strokeWidth={1.1} />
                  <Txt x={X(zh) + 9} y={yc + 22} anchor="start" size={FS_S} fill={C.accent} halo>
                    {`${num(crane.capacity)} т`}
                  </Txt>
                </g>
              );
            })
          : null}

        {/* высотные отметки */}
        {marks.map((m, i) => (
          <g key={`lv${i}`}>
            <line x1={X(m.from) + 3} y1={m.yt} x2={xm} y2={m.yt} stroke={C.thin} strokeWidth={0.8} fill="none" />
            <polygon points={`${xm},${m.yt} ${xm - 5},${m.yt - 8} ${xm + 5},${m.yt - 8}`} fill="none" stroke={C.ink} strokeWidth={1} />
            <polyline points={`${xm + 5},${m.yt - 8} ${xm + 14},${m.ty - 3} ${W - 8},${m.ty - 3}`} fill="none" stroke={C.thin} strokeWidth={0.8} />
            <text x={xm + 17} y={m.ty - 7} fontSize={FS_S} fill={C.ink} stroke="none" textAnchor="start">
              <tspan fontFamily={MONO} fontWeight={600}>
                {level(m.y)}
              </tspan>
              <tspan fontFamily="inherit" fill={C.ink2} fontSize={11.5} dx={6}>
                {m.label}
              </tspan>
            </text>
          </g>
        ))}

        {/* размеры и марки осей */}
        {nSpans > 1 ? <DimH xs={colZs.map(X)} y={yChain} yFrom={yG + 18} labels={colZs.slice(1).map(() => mm(Ls))} /> : null}
        <DimH xs={[X(0), X(B)]} y={yTotal} yFrom={nSpans > 1 ? yChain + 8 : yG + 18} labels={[mm(B)]} />
        {colZs.map((z, j) => (
          <Bubble key={`b${j}`} x={X(z)} y={yBub} label={axisLetter(j)} />
        ))}

        {/* сечения элементов */}
        {legend.map(([name, sec], i) => {
          const col = i < rows ? 0 : 1;
          const row = i < rows ? i : i - rows;
          return (
            <text key={`lg${i}`} x={ML - 30 + col * 480} y={yLeg + row * 19} fontSize={FS_S} fill={C.ink2} stroke="none" textAnchor="start">
              <tspan fontFamily="inherit">{`${name}: `}</tspan>
              <tspan fontFamily="inherit" fill={C.ink} fontWeight={600}>
                {sec}
              </tspan>
            </text>
          );
        })}
      </svg>
    </div>
  );
}
