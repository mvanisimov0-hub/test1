// Геометрия здания: уклоны, шаг рам, раскладка проёмов, площади ограждающих конструкций.
// Оси: X — вдоль здания (длина), Z — поперёк (ширина, плоскость рам), Y — вверх.

import type { Building, Envelope, Opening, WallSide } from './types';

export const WALL_LABEL: Record<WallSide, string> = {
  front: 'Торец по оси 1',
  back: 'Торец по последней оси',
  left: 'Продольная стена по оси А',
  right: 'Продольная стена по крайней буквенной оси',
};

export function slopeTan(b: Building): number {
  return Math.tan((b.slopeDeg * Math.PI) / 180);
}

/** Подъём кровли над карнизом в точке z, м */
export function roofRise(b: Building, z: number): number {
  const t = slopeTan(b);
  if (b.roof === 'mono') return (b.width - z) * t;
  return Math.min(z, b.width - z) * t;
}

export function spanLength(b: Building): number {
  return b.width / Math.max(1, b.spans);
}

export interface StepInfo {
  step: number;
  bays: number;
  /** координаты рам по X */
  frames: number[];
}

/** Шаг рам: заданный менеджером или подобранный по пролёту; длина делится на равные шаги */
export function frameStep(b: Building, requested: number | null): StepInfo {
  const ls = spanLength(b);
  let target = requested ?? (ls <= 6 ? 3 : ls <= 9 ? 4 : ls <= 15 ? 5 : 6);
  target = Math.min(Math.max(target, 1.5), 12);
  let bays = Math.max(1, Math.round(b.length / target));
  if (requested == null && b.length / bays > 6.05) bays += 1;
  const step = b.length / bays;
  const frames = Array.from({ length: bays + 1 }, (_, i) => i * step);
  return { step, bays, frames };
}

export function wallLength(b: Building, wall: WallSide): number {
  return wall === 'left' || wall === 'right' ? b.length : b.width;
}

export interface OpeningInstance {
  opening: Opening;
  index: number;
  wall: WallSide;
  /** начало проёма вдоль стены, м */
  u: number;
  w: number;
  h: number;
  sill: number;
}

/**
 * Раскладка проёмов по стенам. Проёмы с заданной привязкой ставятся по ней,
 * остальные распределяются равномерно в своём ярусе (первый этаж / верхние ряды окон).
 */
/** Сдвинуть проём так, чтобы он не попадал на колонну или стойку (stops — их привязки вдоль стены) */
function clearOfStops(u: number, w: number, stops: number[] | undefined): number {
  if (!stops || stops.length < 2) return u;
  const gap = 0.15;
  if (!stops.some((s) => s > u + 0.05 && s < u + w - 0.05)) return u;
  let best = u;
  let bestShift = Infinity;
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i] + gap;
    const hi = stops[i + 1] - gap - w;
    if (hi < lo) continue;
    const cand = Math.min(Math.max(u, lo), hi);
    if (Math.abs(cand - u) < bestShift) {
      bestShift = Math.abs(cand - u);
      best = cand;
    }
  }
  return best;
}

export function layoutOpenings(
  b: Building,
  openings: Opening[],
  stops?: Partial<Record<WallSide, number[]>>,
): { items: OpeningInstance[]; warnings: string[] } {
  const items: OpeningInstance[] = [];
  const warnings: string[] = [];
  const walls: WallSide[] = ['front', 'back', 'left', 'right'];
  for (const wall of walls) {
    const len = wallLength(b, wall);
    if (b.openSides?.includes(wall)) continue;
    const onWall = openings.filter((o) => o.wall === wall && o.qty > 0);
    if (!onWall.length) continue;
    const bands = new Map<string, Opening[]>();
    for (const o of onWall) {
      const key = o.sill < 2.5 ? 'ground' : `up${o.sill.toFixed(1)}`;
      bands.set(key, [...(bands.get(key) ?? []), o]);
    }
    for (const list of bands.values()) {
      const auto: { o: Opening; i: number }[] = [];
      for (const o of list) {
        for (let i = 0; i < o.qty; i++) {
          const fixed = o.positions?.[i];
          if (fixed != null) {
            // проём расставлен мышью: положение задано явно
            const u = Math.min(Math.max(fixed, 0), Math.max(0, len - o.w));
            items.push({ opening: o, index: i, wall, u, w: o.w, h: o.h, sill: o.sill });
          } else if (o.offset != null) {
            const pitch = o.qty > 1 ? Math.max(o.w, (len - 2 * o.offset - o.w) / (o.qty - 1)) : 0;
            items.push({ opening: o, index: i, wall, u: o.offset + i * pitch, w: o.w, h: o.h, sill: o.sill });
          } else {
            auto.push({ o, i });
          }
        }
      }
      if (!auto.length) continue;
      const n = auto.length;
      const total = auto.reduce((s, a) => s + a.o.w, 0);
      if (total > len - 0.6) {
        warnings.push(`${WALL_LABEL[wall]}: проёмы суммарной шириной ${total.toFixed(1)} м не помещаются на стене ${len.toFixed(1)} м`);
      }
      // крупные проёмы (ворота) занимают равномерно разнесённые места, остальные — между ними
      const sorted = [...auto].sort((a, c) => c.o.w * c.o.h - a.o.w * a.o.h);
      const kinds = new Set(auto.map((a) => a.o.id));
      const slots: (typeof auto)[number][] = new Array(n);
      if (kinds.size > 1) {
        const big = sorted.filter((a) => a.o.kind === 'gate');
        const rest = sorted.filter((a) => a.o.kind !== 'gate');
        const taken = new Set<number>();
        big.forEach((a, k) => {
          let s = Math.min(n - 1, Math.floor(((k + 0.5) * n) / big.length));
          while (taken.has(s)) s = (s + 1) % n;
          taken.add(s);
          slots[s] = a;
        });
        let r = 0;
        for (let s = 0; s < n; s++) if (!slots[s]) slots[s] = rest[r++];
      } else {
        auto.forEach((a, k) => (slots[k] = a));
      }
      slots.forEach((a, s) => {
        const center = ((s + 0.5) * len) / n;
        let u = Math.min(Math.max(center - a.o.w / 2, 0.3), Math.max(0.3, len - a.o.w - 0.3));
        if (a.o.kind !== 'window' || a.o.sill < 2.5) u = clearOfStops(u, a.o.w, stops?.[wall]);
        items.push({ opening: a.o, index: a.i, wall, u, w: a.o.w, h: a.o.h, sill: a.o.sill });
      });
    }
  }
  return { items, warnings };
}

export interface EnvelopeGeometry {
  floorArea: number;
  /** площадь всех уровней (с перекрытиями) */
  totalFloorArea: number;
  floorSlabArea: number;
  perimeter: number;
  /** высота стены у карниза (низкая сторона) и в коньке */
  eaveHeight: number;
  ridgeHeight: number;
  wallGross: number;
  openingsArea: number;
  wallNet: number;
  roofArea: number;
  slopeLength: number;
  overhang: number;
  volume: number;
  /** длины фасонных элементов, м */
  trim: { corners: number; plinth: number; eaves: number; ridge: number; verges: number; openings: number; total: number };
  gutterLength: number;
  downpipes: number;
  gateArea: number;
  doorCount: number;
  windowArea: number;
}

/**
 * Площади ограждений. roofOffset — возвышение верха несущих конструкций над отметкой H
 * у карниза (высота фермы на опоре или половина высоты балки), purlinH — высота прогона.
 */
export function envelopeGeometry(
  b: Building,
  env: Envelope,
  openings: Opening[],
  roofOffset: number,
  purlinH: number,
): EnvelopeGeometry {
  const L = b.length;
  const B = b.width;
  const t = slopeTan(b);
  const cos = Math.cos((b.slopeDeg * Math.PI) / 180);
  const base = b.height + roofOffset + purlinH;
  const hasWalls = env.walls !== 'none';
  const overhang = B <= 6 ? 0.2 : 0.3;

  const riseMax = b.roof === 'mono' ? B * t : (B / 2) * t;
  const riseArea = b.roof === 'mono' ? (B * B * t) / 2 : (B * B * t) / 4;
  const eaveHeight = base;
  const ridgeHeight = base + riseMax;

  // площади стен по сторонам; сторона примыкания к другому блоку не обшивается
  const open = new Set(b.openSides ?? []);
  const sideArea: Record<WallSide, number> = {
    left: L * (b.roof === 'mono' ? base + riseMax : base),
    right: L * base,
    front: B * base + riseArea,
    back: B * base + riseArea,
  };
  const sides = (['left', 'right', 'front', 'back'] as WallSide[]).filter((w) => !open.has(w));
  const wallGross = hasWalls ? sides.reduce((a, w) => a + sideArea[w], 0) : 0;

  let gateArea = 0;
  let doorArea = 0;
  let doorCount = 0;
  let windowArea = 0;
  let openTrim = 0;
  for (const o of openings) {
    if (open.has(o.wall)) continue;
    const a = o.w * o.h * o.qty;
    if (o.kind === 'gate') {
      gateArea += a;
      openTrim += (2 * o.h + o.w) * o.qty;
    } else if (o.kind === 'door') {
      doorArea += a;
      doorCount += o.qty;
      openTrim += (2 * o.h + o.w) * o.qty;
    } else {
      windowArea += a;
      openTrim += 2 * (o.h + o.w) * o.qty;
    }
  }
  const openingsArea = hasWalls ? gateArea + doorArea + windowArea : 0;
  const wallNet = Math.max(0, wallGross - openingsArea);

  const slopeLength = b.roof === 'mono' ? (B + 2 * overhang) / cos : (B / 2 + overhang) / cos;
  const roofArea = (b.roof === 'mono' ? slopeLength : 2 * slopeLength) * (L + 2 * overhang);

  const perimeter = 2 * (L + B);
  const openLen = [...open].reduce((a, w) => a + (w === 'left' || w === 'right' ? L : B), 0);
  const corners = hasWalls ? 4 * (base + riseMax / 2) * 2 : 0; // наружные и внутренние нащельники
  const plinth = hasWalls ? perimeter - openLen : 0;
  const eaves = 2 * (L + 2 * overhang);
  const ridge = b.roof === 'gable' ? L + 2 * overhang : 0;
  const verges = (b.roof === 'gable' ? 4 : 2) * slopeLength;
  const trimOpen = hasWalls ? openTrim : 0;

  const gutterLength = b.roof === 'gable' ? 2 * (L + 2 * overhang) : L + 2 * overhang;
  const downpipes = Math.max(2, Math.ceil(gutterLength / 12));

  const floorArea = L * B;
  const floorLen = b.floors > 1 ? Math.min(L, b.floorLength ?? L) : 0;
  const floorSlabArea = floorLen * B * (b.floors - 1);

  return {
    floorArea,
    totalFloorArea: floorArea + floorSlabArea,
    floorSlabArea,
    perimeter,
    eaveHeight,
    ridgeHeight,
    wallGross,
    openingsArea,
    wallNet,
    roofArea,
    slopeLength,
    overhang,
    volume: L * (B * base + riseArea),
    trim: {
      corners,
      plinth,
      eaves,
      ridge,
      verges,
      openings: trimOpen,
      total: corners + plinth + eaves + ridge + verges + trimOpen,
    },
    gutterLength,
    downpipes,
    gateArea: hasWalls ? gateArea : 0,
    doorCount: hasWalls ? doorCount : 0,
    windowArea: hasWalls ? windowArea : 0,
  };
}
