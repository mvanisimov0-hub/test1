// Раскладка стеновых и кровельных панелей и подсчёт фасонных элементов.
// Раскладка — единый источник для чертежей фасадов, ведомости панелей и сметы.

import { roofRise, wallLength, type EnvelopeGeometry, type OpeningInstance } from './geometry';
import type { StructureResult } from './structTypes';
import type { Project, WallSide } from './types';

/** Рабочая ширина панели (модуль), м */
export const PANEL_MODULE = 1.0;
/** Наибольшая длина панели по условиям перевозки и монтажа, м */
export const PANEL_MAX_LENGTH = 12;
/** Отступ внутренней грани стены от оси колонн, м */
export const WALL_OFFSET = 0.12;
/** Длина фасонного элемента и нахлёст при стыковке, м */
export const TRIM_PIECE = 3.0;
export const TRIM_LAP = 0.1;

export type Surface = WallSide | 'roofA' | 'roofB';

export interface PanelPiece {
  surface: Surface;
  /** положение на развёртке: u — вдоль стены (вдоль здания для кровли), v — вверх (по скату от карниза), м */
  u: number;
  v: number;
  du: number;
  dv: number;
  /** заказная длина панели, м */
  length: number;
  /** панель подрезается по месту: по скату, по высоте или с вырезом под проём */
  cut: boolean;
}

export interface PanelGroup {
  kind: 'wall' | 'roof';
  length: number;
  count: number;
  cut: number;
  area: number;
}

export interface TrimItem {
  /** позиция справочника цен */
  priceId: string;
  name: string;
  /** длина по расчёту, м.п., и количество планок стандартной длины */
  length: number;
  pieces: number;
  where: string;
}

export interface PanelsResult {
  module: number;
  vertical: boolean;
  pieces: PanelPiece[];
  groups: PanelGroup[];
  /** заказная площадь панелей: модуль × длина, м² */
  wallArea: number;
  roofArea: number;
  wallCount: number;
  roofCount: number;
  trims: TrimItem[];
  trimLength: number;
  /** верх стены в точке u — для чертежей фасадов */
  wallTop: Record<WallSide, (u: number) => number>;
  /** привязки вертикальных стыков панелей (оси колонн и стоек) по стенам */
  stops: Record<WallSide, number[]>;
}

const WALLS: WallSide[] = ['left', 'right', 'front', 'back'];
const up2 = (v: number) => Math.ceil(v * 100 - 1e-6) / 100;

function subtract(a: number, b: number, holes: [number, number][]): [number, number][] {
  let out: [number, number][] = [[a, b]];
  for (const [h1, h2] of holes) {
    const next: [number, number][] = [];
    for (const [s, e] of out) {
      if (h2 <= s || h1 >= e) next.push([s, e]);
      else {
        if (h1 > s) next.push([s, h1]);
        if (h2 < e) next.push([h2, e]);
      }
    }
    out = next;
  }
  return out;
}

export function calcPanels(p: Project, st: StructureResult, geo: EnvelopeGeometry): PanelsResult {
  const b = p.building;
  const env = p.envelope;
  const L = b.length;
  const B = b.width;
  const m = PANEL_MODULE;
  const tan = Math.tan((b.slopeDeg * Math.PI) / 180);
  const hasWalls = env.walls !== 'none';
  const open = new Set(b.openSides ?? []);
  const wallT = env.walls === 'sandwich' ? env.wallThk / 1000 : 0.04;
  const roofBase = b.height + st.roofOffset + st.purlinH;
  const vertical = env.walls === 'proflist' || env.wallLayout === 'vertical';

  const topAt = (wall: WallSide, u: number): number => {
    if (wall === 'left') return roofBase + roofRise(b, 0);
    if (wall === 'right') return roofBase + roofRise(b, B);
    return roofBase + roofRise(b, Math.min(Math.max(u, 0), B));
  };
  const wallTop = Object.fromEntries(WALLS.map((w) => [w, (u: number) => topAt(w, u)])) as PanelsResult['wallTop'];
  const stops: Record<WallSide, number[]> = { left: st.frames, right: st.frames, front: st.endStops, back: st.endStops };

  const pieces: PanelPiece[] = [];
  const openingsOn = (wall: WallSide): OpeningInstance[] => st.openings.filter((o) => o.wall === wall);

  if (hasWalls) {
    for (const wall of WALLS) {
      if (open.has(wall)) continue;
      const len = wallLength(b, wall);
      const long = wall === 'left' || wall === 'right';
      const ext = long ? WALL_OFFSET + wallT : WALL_OFFSET;
      const ops = openingsOn(wall);
      const top = (u: number) => topAt(wall, u);
      const maxTop = (u0: number, u1: number) => {
        let t = Math.max(top(u0), top(u1));
        if (!long && b.roof === 'gable' && u0 < B / 2 && u1 > B / 2) t = Math.max(t, top(B / 2));
        return t;
      };

      if (vertical) {
        for (let u0 = -ext; u0 < len + ext - 0.02; u0 += m) {
          const u1 = Math.min(u0 + m, len + ext);
          const h = maxTop(u0, u1);
          const full = ops.filter((o) => o.u <= u0 + 0.02 && o.u + o.w >= u1 - 0.02);
          const partial = ops.some((o) => o.u < u1 - 0.02 && o.u + o.w > u0 + 0.02 && !full.includes(o));
          const sloped = Math.abs(top(u0) - top(u1)) > 0.01;
          for (const [v0, v1] of subtract(0, h, full.map((o) => [o.sill, o.sill + o.h] as [number, number]))) {
            if (v1 - v0 < 0.15) continue;
            pieces.push({ surface: wall, u: u0, v: v0, du: u1 - u0, dv: v1 - v0, length: up2(v1 - v0), cut: partial || sloped || u1 - u0 < m - 0.01 });
          }
        }
      } else {
        // горизонтальная раскладка: панели от колонны до колонны, стыки на осях
        const st0 = stops[wall].filter((s) => s > 0.01 && s < len - 0.01);
        const edges = [-ext, ...st0, len + ext];
        for (let i = 0; i < edges.length - 1; i++) {
          const b0 = edges[i];
          const b1 = edges[i + 1];
          const bayTop = maxTop(b0, b1);
          for (let v0 = 0; v0 < bayTop - 0.02; v0 += m) {
            const v1 = Math.min(v0 + m, bayTop);
            // участок панели, где стена выше низа ряда (скат в торце)
            let a = b0;
            let c = b1;
            let sloped = false;
            if (!long && tan > 0 && v0 > roofBase - 1e-6) {
              const d = (v0 - roofBase) / tan;
              if (b.roof === 'gable') {
                a = Math.max(a, d);
                c = Math.min(c, B - d);
              } else {
                c = Math.min(c, B - d);
              }
              sloped = true;
            } else if (!long && Math.min(top(b0), top(b1)) < v1 - 0.01) {
              sloped = true;
            }
            if (c - a < 0.25) continue;
            const full = ops.filter((o) => o.sill <= v0 + 0.02 && o.sill + o.h >= v1 - 0.02);
            const partial = ops.filter((o) => !full.includes(o) && o.sill < v1 - 0.02 && o.sill + o.h > v0 + 0.02);
            for (const [s, e] of subtract(a, c, full.map((o) => [o.u, o.u + o.w] as [number, number]))) {
              if (e - s < 0.25) continue;
              const cutout = partial.some((o) => o.u < e - 0.02 && o.u + o.w > s + 0.02);
              pieces.push({ surface: wall, u: s, v: v0, du: e - s, dv: v1 - v0, length: up2(e - s), cut: sloped || cutout || v1 - v0 < m - 0.01 });
            }
          }
        }
      }
    }
  }

  // кровля: панели вдоль ската от карниза до конька, модуль — вдоль здания
  const side = hasWalls ? WALL_OFFSET + wallT : 0;
  const roofLen = L + 2 * (geo.overhang + side);
  const slope = geo.slopeLength + side / Math.cos((b.slopeDeg * Math.PI) / 180);
  const parts = Math.max(1, Math.ceil(slope / PANEL_MAX_LENGTH - 1e-6));
  const lap = parts > 1 ? 0.3 : 0;
  const partLen = slope / parts + lap * ((parts - 1) / parts);
  const surfaces: Surface[] = b.roof === 'gable' ? ['roofA', 'roofB'] : ['roofA'];
  for (const surface of surfaces) {
    for (let u0 = 0; u0 < roofLen - 0.02; u0 += m) {
      const du = Math.min(m, roofLen - u0);
      for (let k = 0; k < parts; k++) {
        pieces.push({ surface, u: u0, v: (k * slope) / parts, du, dv: slope / parts, length: up2(partLen), cut: du < m - 0.01 });
      }
    }
  }

  // ведомость по заказным длинам
  const map = new Map<string, PanelGroup>();
  for (const q of pieces) {
    const kind = q.surface === 'roofA' || q.surface === 'roofB' ? 'roof' : 'wall';
    const key = `${kind}|${q.length.toFixed(2)}`;
    const g = map.get(key) ?? { kind, length: q.length, count: 0, cut: 0, area: 0 };
    g.count++;
    if (q.cut) g.cut++;
    g.area += q.length * m;
    map.set(key, g);
  }
  const groups = [...map.values()].sort((x, y) => (x.kind === y.kind ? y.length - x.length : x.kind === 'wall' ? -1 : 1));
  const sum = (kind: 'wall' | 'roof', f: (g: PanelGroup) => number) => groups.filter((g) => g.kind === kind).reduce((a, g) => a + f(g), 0);

  // ── фасонные элементы ──
  const trims: TrimItem[] = [];
  const trim = (priceId: string, name: string, length: number, where: string) => {
    if (length > 0.05) trims.push({ priceId, name, length, pieces: Math.ceil(length / (TRIM_PIECE - TRIM_LAP) - 1e-6), where });
  };
  const eavesLen = L + 2 * geo.overhang;
  if (hasWalls) {
    const sides = WALLS.filter((w) => !open.has(w));
    const doorsWidth = st.openings.filter((o) => o.opening.kind !== 'window' && !open.has(o.wall)).reduce((a, o) => a + o.w, 0);
    const perim = sides.reduce((a, w) => a + wallLength(b, w), 0);
    trim('trim.plinth', 'Отлив цокольный', Math.max(0, perim - doorsWidth), 'по низу стен, кроме ворот и дверей');
    // углы: только там, где сходятся две обшитые стены
    const cornerPairs: [WallSide, WallSide, number][] = [
      ['left', 'front', topAt('left', 0)],
      ['left', 'back', topAt('left', 0)],
      ['right', 'front', topAt('right', 0)],
      ['right', 'back', topAt('right', 0)],
    ];
    const cornerLen = cornerPairs.filter(([w1, w2]) => !open.has(w1) && !open.has(w2)).reduce((a, c) => a + c[2], 0);
    trim('trim.corner.out', 'Нащельник угловой наружный', cornerLen, 'наружные углы здания');
    trim('trim.corner.in', 'Нащельник угловой внутренний', cornerLen, 'внутренние углы здания');
    if (!vertical) {
      let joints = 0;
      for (const w of sides) {
        const len = wallLength(b, w);
        for (const s of stops[w]) if (s > 0.01 && s < len - 0.01) joints += topAt(w, s);
      }
      trim('trim.joint', 'Нащельник вертикального стыка панелей', joints, 'стыки панелей на осях колонн');
    }
    let frame = 0;
    let sills = 0;
    for (const o of st.openings) {
      if (open.has(o.wall)) continue;
      frame += 2 * o.h + o.w;
      if (o.opening.kind === 'window') sills += o.w;
    }
    trim('trim.opening', 'Планка обрамления проёма наружная', frame, 'верх и боковые стороны проёмов');
    trim('trim.reveal', 'Откос проёма внутренний', frame, 'верх и боковые стороны проёмов изнутри');
    trim('trim.sill', 'Отлив оконный', sills, 'низ оконных проёмов');
    trim('trim.wallroof', 'Нащельник примыкания стены к кровле внутренний', perim, 'по верху стен изнутри');
  }
  const cos = Math.cos((b.slopeDeg * Math.PI) / 180);
  const verge = geo.slopeLength;
  if (b.roof === 'gable') {
    trim('trim.ridge', 'Планка конька наружная', eavesLen, 'конёк кровли');
    trim('trim.ridge.in', 'Планка конька внутренняя', L, 'конёк кровли изнутри');
    trim('trim.eave', 'Планка карнизная', 2 * eavesLen, 'карнизы');
    trim('trim.verge', 'Планка торцевая (ветровая)', 4 * verge, 'торцы скатов');
  } else {
    const shared = open.has('left');
    trim('trim.eave', 'Планка карнизная', eavesLen, 'нижний карниз');
    if (shared) trim('trim.abut', 'Планка примыкания кровли к стене', eavesLen, 'примыкание кровли к стене основного здания');
    else trim('trim.verge', 'Планка торцевая (ветровая)', eavesLen, 'верхний край ската');
    trim('trim.verge', 'Планка торцевая (ветровая)', 2 * verge, 'торцы ската');
  }
  if (open.has('front') || open.has('back')) {
    trim('trim.abut', 'Планка примыкания кровли к стене', (b.roof === 'gable' ? B : B / cos) + 2 * geo.overhang, 'примыкание кровли к стене основного здания');
  }
  // одинаковые планки из разных мест — одной строкой
  const merged = new Map<string, TrimItem>();
  for (const t of trims) {
    const prev = merged.get(t.priceId);
    if (prev) {
      prev.length += t.length;
      prev.where += `; ${t.where}`;
      prev.pieces = Math.ceil(prev.length / (TRIM_PIECE - TRIM_LAP) - 1e-6);
    } else merged.set(t.priceId, { ...t });
  }
  const trimList = [...merged.values()];

  return {
    module: m,
    vertical,
    pieces,
    groups,
    wallArea: sum('wall', (g) => g.area),
    roofArea: sum('roof', (g) => g.area),
    wallCount: sum('wall', (g) => g.count),
    roofCount: sum('roof', (g) => g.count),
    trims: trimList,
    trimLength: trimList.reduce((a, t) => a + t.length, 0),
    wallTop,
    stops,
  };
}
