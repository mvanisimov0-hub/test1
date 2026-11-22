// Расчётная схема поперечной рамы: узлы, стержни, загружения.
// Плоскость рамы: горизонтальная ось — Z здания (поперёк), вертикальная — Y.

import type { FemNode, LoadCase } from './fem';
import { roofRise, slopeTan, spanLength } from './geometry';
import { CANOPY_WIND, GAMMA, WALL_WIND, roofWindCoef, snowMu, snowUneven } from './loads';
import type { BaseFix, Building, CraneType, RoofScheme } from './types';

export type GroupKey =
  | 'colOuter'
  | 'colInner'
  | 'topChord'
  | 'botChord'
  | 'webSup'
  | 'web'
  | 'rafter'
  | 'floorBeam'
  | 'floorPost';

export const GROUP_LABEL: Record<GroupKey, string> = {
  colOuter: 'Колонны крайних рядов',
  colInner: 'Колонны средних рядов',
  topChord: 'Верхний пояс ферм',
  botChord: 'Нижний пояс ферм',
  webSup: 'Опорные раскосы и стойки ферм',
  web: 'Решётка ферм',
  rafter: 'Ригели рам',
  floorBeam: 'Главные балки перекрытия',
  floorPost: 'Стойки перекрытия',
};

export type MemberPart = 'column' | 'top' | 'bottom' | 'vertical' | 'diagonal' | 'rafter' | 'floorBeam' | 'post';

export interface PlaneMember {
  n1: number;
  n2: number;
  group: GroupKey;
  part: MemberPart;
  rel1: boolean;
  rel2: boolean;
  /** номер пролёта (для ферм, балок, перекрытий) или ряда колонн */
  span: number;
  len: number;
}

export interface ColumnLine {
  index: number;
  z: number;
  outer: boolean;
  /** −1 левая крайняя, +1 правая крайняя, 0 средняя */
  side: -1 | 0 | 1;
  nodes: number[];
  levels: number[];
  members: number[];
  /** отметка верха колонны */
  height: number;
  /** отметка опирания несущей конструкции покрытия (для расчётной длины) */
  clear: number;
  /** высота стены над оголовком колонны, м */
  wallExtra: number;
  /** узел крепления нижнего пояса фермы или ригеля */
  seat: number;
  craneNode: number | null;
}

export interface PostLine {
  z: number;
  span: number;
  nodes: number[];
  members: number[];
  height: number;
}

export interface RoofSeg {
  n1: number;
  n2: number;
  /** горизонтальная проекция, м */
  dz: number;
  /** +1 — скат поднимается слева направо, −1 — опускается */
  sign: 1 | -1;
}

export interface SpanInfo {
  index: number;
  zA: number;
  zB: number;
  panels: number;
  /** узлы верха несущей конструкции слева направо */
  roofNodes: number[];
  bottomNodes: number[];
  members: number[];
  /** узлы подвески кран-балки */
  suspNodes: [number, number] | null;
}

export interface PlaneFrame {
  scheme: RoofScheme;
  baseFix: BaseFix;
  nodes: FemNode[];
  members: PlaneMember[];
  columns: ColumnLine[];
  posts: PostLine[];
  spans: SpanInfo[];
  roofSegs: RoofSeg[];
  floorLevels: number[];
  floorBeams: number[];
  /** возвышение верха несущей конструкции над отметкой H у карниза, м */
  roofOffset: number;
  /** координаты z линий прогонов */
  purlinZ: number[];
  /** координаты z распорок по нижним поясам ферм */
  tieZ: number[];
  /** расстояние между раскреплениями нижнего пояса, м */
  tieSpacing: number;
  craneLevel: number | null;
  withFloors: boolean;
  sideBraced: boolean;
  trussRigid: boolean;
}

export interface FrameBuildOptions {
  scheme: RoofScheme;
  baseFix: BaseFix;
  withFloors: boolean;
  craneType: CraneType;
  craneCapacity: number;
  /** наибольший шаг прогонов, м */
  maxPurlin: number;
  /** связевая схема: верх колонн раскреплён связями покрытия и торцов */
  sideBraced: boolean;
  /** жёсткое сопряжение ферм с крайними колоннами */
  trussRigid: boolean;
}

const up5 = (v: number) => Math.ceil(v * 20 - 1e-9) / 20;

/** Высота фермы на опоре (двускатная) или высота фермы с параллельными поясами (односкатная) */
export function trussDepth(b: Building): number {
  const ls = spanLength(b);
  if (b.roof === 'mono') return up5(Math.min(2.4, Math.max(0.4, ls / 12)));
  let h0 = Math.min(1.2, Math.max(0.3, ls / 30));
  if (b.spans === 1) {
    // в коньке высота фермы не менее 1/10 пролёта
    const need = ls / 10 - (ls / 2) * slopeTan(b);
    h0 = Math.min(2.0, Math.max(h0, need));
  }
  return up5(h0);
}

export function craneBracketDrop(capacity: number): number {
  return capacity <= 5 ? 1.4 : capacity <= 10 ? 1.7 : 2.1;
}

export function buildPlaneFrame(b: Building, o: FrameBuildOptions): PlaneFrame {
  const B = b.width;
  const H = b.height;
  const nSpans = Math.max(1, b.spans);
  const Ls = B / nSpans;
  const cos = Math.cos((b.slopeDeg * Math.PI) / 180);
  const truss = o.scheme === 'truss';
  const nodes: FemNode[] = [];
  const members: PlaneMember[] = [];

  const addNode = (x: number, y: number, fix?: FemNode['fix']) => {
    nodes.push({ x, y, fix });
    return nodes.length - 1;
  };
  const addMember = (
    n1: number,
    n2: number,
    group: GroupKey,
    part: MemberPart,
    span: number,
    rel1 = false,
    rel2 = false,
  ) => {
    const len = Math.hypot(nodes[n2].x - nodes[n1].x, nodes[n2].y - nodes[n1].y);
    members.push({ n1, n2, group, part, rel1, rel2, span, len });
    return members.length - 1;
  };

  const depth = truss ? trussDepth(b) : 0;
  const gable = b.roof === 'gable';
  const rise = (z: number) => roofRise(b, z);
  const yBot = (z: number) => (gable ? H : H + rise(z));
  const yTop = (z: number) => (gable ? H + depth + rise(z) : H + rise(z) + depth);
  const yAxis = (z: number) => H + rise(z);
  const colTopY = (z: number) => (truss ? yBot(z) : yAxis(z));
  const roofOffset = truss ? depth : 0.15;

  const withFloors = o.withFloors && b.floors > 1;
  const hf = H / Math.max(1, b.floors);
  const floorLevels = withFloors ? Array.from({ length: b.floors - 1 }, (_, i) => (i + 1) * hf) : [];
  const craneLevel = o.craneType === 'bridge' ? Math.max(H - craneBracketDrop(o.craneCapacity), 0.6 * H) : null;
  const baseFix: FemNode['fix'] = o.baseFix === 'fixed' ? [true, true, true] : [true, true, false];

  // колонны
  const columns: ColumnLine[] = [];
  for (let j = 0; j <= nSpans; j++) {
    const z = j * Ls;
    const outer = j === 0 || j === nSpans;
    const seatY = colTopY(z);
    // при жёстком сопряжении крайняя колонна доходит до верхнего пояса фермы
    const top = truss && o.trussRigid && outer ? yTop(z) : seatY;
    const set = new Set<number>([0, seatY, top]);
    for (const lv of floorLevels) if (lv < top - 0.2) set.add(lv);
    if (craneLevel != null && craneLevel < top - 0.2) set.add(craneLevel);
    const levels = [...set].sort((a, c) => a - c);
    // перекрытие работает как жёсткий диск и передаёт горизонтальные силы на связи в торцах:
    // узлы колонн на отметках перекрытий закреплены от смещения в плоскости рамы
    // то же при связевой схеме малых зданий: от бокового смещения раму держат связи покрытия и торцов
    // (закрепляется один узел, чтобы не создавать ложного распора в двускатном ригеле)
    const ns = levels.map((y, i) => {
      if (i === 0) return addNode(z, y, baseFix);
      const held = floorLevels.some((lv) => Math.abs(lv - y) < 1e-6) || (o.sideBraced && j === 0 && i === levels.length - 1);
      return addNode(z, y, held ? [true, false, false] : undefined);
    });
    const ms: number[] = [];
    for (let i = 0; i < ns.length - 1; i++) ms.push(addMember(ns[i], ns[i + 1], outer ? 'colOuter' : 'colInner', 'column', j));
    columns.push({
      index: j,
      z,
      outer,
      side: j === 0 ? -1 : j === nSpans ? 1 : 0,
      nodes: ns,
      levels,
      members: ms,
      height: top,
      clear: seatY,
      wallExtra: truss ? yTop(z) - top : roofOffset,
      seat: ns[levels.findIndex((l) => Math.abs(l - seatY) < 1e-6)],
      craneNode: craneLevel != null && set.has(craneLevel) ? ns[levels.indexOf(craneLevel)] : null,
    });
  }
  const colTop = columns.map((c) => c.seat);
  const rigidTop = (j: number) => (truss && o.trussRigid && columns[j].outer ? columns[j].nodes[columns[j].nodes.length - 1] : null);
  const levelNode = (c: ColumnLine, y: number) => c.nodes[c.levels.findIndex((l) => Math.abs(l - y) < 1e-6)];

  // покрытие
  const spans: SpanInfo[] = [];
  const roofSegs: RoofSeg[] = [];
  const tieZ: number[] = [];
  const nt = Math.max(1, Math.ceil(Ls / 6 - 1e-6) - 1);
  for (let s = 0; s < nSpans; s++) {
    const zA = s * Ls;
    const zB = zA + Ls;
    const ridgeInside = gable && nSpans % 2 === 1 && s === (nSpans - 1) / 2;
    const ms: number[] = [];
    let roofNodes: number[] = [];
    let bottomNodes: number[] = [];
    let n: number;
    if (truss) {
      const pTarget = Math.min(o.maxPurlin, Math.max(1.5, Ls / 8));
      n = Math.max(2, 2 * Math.ceil(Ls / (2 * pTarget) - 1e-6));
      const p = Ls / n;
      for (let i = 0; i <= n; i++) {
        const z = zA + i * p;
        bottomNodes.push(i === 0 ? colTop[s] : i === n ? colTop[s + 1] : addNode(z, yBot(z)));
        const shared = i === 0 ? rigidTop(s) : i === n ? rigidTop(s + 1) : null;
        roofNodes.push(shared ?? addNode(z, yTop(z)));
      }
      const rigidL = rigidTop(s) != null;
      const rigidR = rigidTop(s + 1) != null;
      for (let i = 0; i < n; i++) {
        ms.push(addMember(bottomNodes[i], bottomNodes[i + 1], 'botChord', 'bottom', s, i === 0, i === n - 1));
        ms.push(addMember(roofNodes[i], roofNodes[i + 1], 'topChord', 'top', s, i === 0 && rigidL, i === n - 1 && rigidR));
      }
      for (let i = 0; i <= n; i++) {
        // при жёстком сопряжении опорной стойкой служит сама колонна
        if ((i === 0 && rigidL) || (i === n && rigidR)) continue;
        ms.push(addMember(bottomNodes[i], roofNodes[i], i === 0 || i === n ? 'webSup' : 'web', 'vertical', s, true, true));
      }
      for (let i = 0; i < n; i++) {
        const g: GroupKey = i === 0 || i === n - 1 ? 'webSup' : 'web';
        // раскосы нисходящие к середине пролёта: при равномерной нагрузке растянуты
        if (i < n / 2) ms.push(addMember(roofNodes[i], bottomNodes[i + 1], g, 'diagonal', s, true, true));
        else ms.push(addMember(bottomNodes[i], roofNodes[i + 1], g, 'diagonal', s, true, true));
      }
      for (let k = 1; k <= nt; k++) {
        const i = Math.min(n - 1, Math.max(1, Math.round((k * n) / (nt + 1))));
        const z = zA + i * p;
        if (!tieZ.some((v) => Math.abs(v - z) < 1e-6)) tieZ.push(z);
      }
    } else {
      const slopeLen = (ridgeInside ? Ls / 2 : Ls) / cos;
      const half = Math.max(1, Math.ceil(slopeLen / o.maxPurlin - 1e-6));
      n = ridgeInside ? 2 * half : half;
      const p = Ls / n;
      for (let i = 0; i <= n; i++) {
        const z = zA + i * p;
        roofNodes.push(i === 0 ? colTop[s] : i === n ? colTop[s + 1] : addNode(z, yAxis(z)));
      }
      bottomNodes = roofNodes;
      for (let i = 0; i < n; i++) ms.push(addMember(roofNodes[i], roofNodes[i + 1], 'rafter', 'rafter', s));
    }
    for (let i = 0; i < n; i++) {
      const dy = nodes[roofNodes[i + 1]].y - nodes[roofNodes[i]].y;
      roofSegs.push({ n1: roofNodes[i], n2: roofNodes[i + 1], dz: Ls / n, sign: dy >= 0 ? 1 : -1 });
    }
    // точки подвески кран-балки: на расстоянии ~0,12 пролёта от колонн
    let suspNodes: [number, number] | null = null;
    if (o.craneType === 'suspended' && n >= 2) {
      const a = Math.max(1.2, 0.12 * Ls);
      const i1 = Math.min(Math.floor(n / 2), Math.max(1, Math.round((a / Ls) * n)));
      suspNodes = [bottomNodes[i1], bottomNodes[n - i1]];
    }
    spans.push({ index: s, zA, zB, panels: n, roofNodes, bottomNodes, members: ms, suspNodes });
  }

  // перекрытия: стойки с шагом до 6 м и шарнирно опёртые главные балки
  const posts: PostLine[] = [];
  const floorBeams: number[] = [];
  if (withFloors && floorLevels.length) {
    for (let s = 0; s < nSpans; s++) {
      const m = Math.max(0, Math.ceil(Ls / 6 - 1e-6) - 1);
      const spanPosts: PostLine[] = [];
      for (let q = 1; q <= m; q++) {
        const z = s * Ls + (q * Ls) / (m + 1);
        const ns = [addNode(z, 0, [true, true, false])];
        const ms: number[] = [];
        for (const lv of floorLevels) {
          const nn = addNode(z, lv);
          ms.push(addMember(ns[ns.length - 1], nn, 'floorPost', 'post', s));
          ns.push(nn);
        }
        const pl = { z, span: s, nodes: ns, members: ms, height: floorLevels[floorLevels.length - 1] };
        posts.push(pl);
        spanPosts.push(pl);
      }
      floorLevels.forEach((lv, k) => {
        const chain = [levelNode(columns[s], lv), ...spanPosts.map((p) => p.nodes[k + 1]), levelNode(columns[s + 1], lv)];
        for (let i = 0; i < chain.length - 1; i++) {
          if (chain[i] == null || chain[i + 1] == null) continue;
          floorBeams.push(addMember(chain[i], chain[i + 1], 'floorBeam', 'floorBeam', s, true, true));
        }
      });
    }
  }

  // линии прогонов: в каждом узле верха; в коньке — два прогона по обе стороны
  const purlinZ: number[] = [];
  const ridgeZ = gable ? B / 2 : -1;
  for (const sp of spans) {
    for (const nn of sp.roofNodes) {
      const z = nodes[nn].x;
      if (Math.abs(z - ridgeZ) < 1e-6) {
        for (const zz of [z - 0.2, z + 0.2]) if (!purlinZ.some((v) => Math.abs(v - zz) < 1e-6)) purlinZ.push(zz);
      } else if (!purlinZ.some((v) => Math.abs(v - z) < 1e-6)) purlinZ.push(z);
    }
  }
  purlinZ.sort((a, c) => a - c);
  tieZ.sort((a, c) => a - c);

  return {
    scheme: o.scheme,
    baseFix: o.baseFix,
    nodes,
    members,
    columns,
    posts,
    spans,
    roofSegs,
    floorLevels,
    floorBeams,
    roofOffset,
    purlinZ,
    tieZ: truss ? tieZ : [],
    tieSpacing: Ls / (nt + 1),
    craneLevel,
    withFloors,
    sideBraced: o.sideBraced,
    trussRigid: truss && o.trussRigid,
  };
}

// ───────────────────────── загружения ─────────────────────────

export type CaseGroup = 'G' | 'S' | 'W' | 'C' | 'Q';

export interface CaseDef {
  id: string;
  name: string;
  group: CaseGroup;
  /** расчётные нагрузки */
  lc: LoadCase;
  /** коэффициент перехода к нормативным значениям (1/γf) */
  toNorm: number;
}

export interface LoadInput {
  /** шаг рам (грузовая ширина), м */
  step: number;
  /** постоянная нагрузка от покрытия на 1 м² ската, кПа: нормативная и расчётная */
  roofDeadN: number;
  roofDead: number;
  /** длительная технологическая нагрузка на 1 м² плана, кПа (расчётная) */
  tech: number;
  techN: number;
  /** расчётная снеговая нагрузка на 1 м² плана при μ = 1, кПа */
  snow: number;
  /** расчётное ветровое давление при c = 1, кПа */
  wind: number;
  /** расчётный вес стенового ограждения на 1 м² стены, кПа */
  wall: number;
  wallN: number;
  canopy: boolean;
  /** постоянная нагрузка от перекрытия, кПа */
  floorDead: number;
  floorDeadN: number;
  /** полезная нагрузка на перекрытие, расчётная, кПа */
  floorLive: number;
  floorLiveGamma: number;
  crane: CraneLoads | null;
  /** масса погонного метра стержней по группам, кг/м */
  massOf: (g: GroupKey) => number;
}

export interface CraneLoads {
  type: 'bridge' | 'suspended';
  /** расчётные давления на колонну/точку подвеса: большее и меньшее, кН */
  dMax: number;
  dMin: number;
  /** поперечное тормозное усилие, кН */
  t: number;
  /** эксцентриситет подкрановой балки относительно оси колонны, м */
  e: number;
}

function emptyCase(): LoadCase {
  return { nodal: [], dist: [] };
}

/** Собственный вес и постоянные нагрузки; k = 'design' | 'norm' */
function deadCase(b: Building, f: PlaneFrame, li: LoadInput, norm: boolean): LoadCase {
  const lc = emptyCase();
  const cos = Math.cos((b.slopeDeg * Math.PI) / 180);
  const g = 9.81 / 1000;
  const kSteel = norm ? 1 : GAMMA.steel;
  f.members.forEach((m) => {
    const w = (li.massOf(m.group) * m.len * g * kSteel) / 2;
    lc.nodal.push({ node: m.n1, fx: 0, fy: -w, mz: 0 }, { node: m.n2, fx: 0, fy: -w, mz: 0 });
  });
  const roof = norm ? li.roofDeadN : li.roofDead;
  const tech = norm ? li.techN : li.tech;
  for (const s of f.roofSegs) {
    const p = ((roof * s.dz) / cos + tech * s.dz) * li.step * 0.5;
    lc.nodal.push({ node: s.n1, fx: 0, fy: -p, mz: 0 }, { node: s.n2, fx: 0, fy: -p, mz: 0 });
  }
  if (!li.canopy) {
    const wall = norm ? li.wallN : li.wall;
    for (const c of f.columns) {
      if (!c.outer) continue;
      lc.nodal.push({ node: c.nodes[c.nodes.length - 1], fx: 0, fy: -wall * li.step * (c.height + c.wallExtra), mz: 0 });
    }
  }
  const fd = norm ? li.floorDeadN : li.floorDead;
  for (const idx of f.floorBeams) lc.dist.push({ elem: idx, qx: 0, qy: -fd * li.step });
  return lc;
}

function snowCase(f: PlaneFrame, li: LoadInput, mu: number, left: number, right: number): LoadCase {
  const lc = emptyCase();
  for (const s of f.roofSegs) {
    const k = s.sign > 0 ? left : right;
    const p = li.snow * mu * k * s.dz * li.step * 0.5;
    lc.nodal.push({ node: s.n1, fx: 0, fy: -p, mz: 0 }, { node: s.n2, fx: 0, fy: -p, mz: 0 });
  }
  return lc;
}

/** Ветер поперёк здания. dir = +1 — слева направо. */
function windCase(b: Building, f: PlaneFrame, li: LoadInput, dir: 1 | -1, canopyCoef?: number): LoadCase {
  const lc = emptyCase();
  const a = (b.slopeDeg * Math.PI) / 180;
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const rc = roofWindCoef(b.roof, b.slopeDeg);
  for (const s of f.roofSegs) {
    const windward = s.sign * dir > 0;
    const ce = canopyCoef ?? (windward ? rc.windward : rc.leeward);
    const area = (s.dz / cos) * li.step;
    const fx = ce * li.wind * area * s.sign * sin * 0.5;
    const fy = -ce * li.wind * area * cos * 0.5;
    lc.nodal.push({ node: s.n1, fx, fy, mz: 0 }, { node: s.n2, fx, fy, mz: 0 });
  }
  const first = f.columns[0];
  const last = f.columns[f.columns.length - 1];
  if (li.canopy) {
    // лобовое давление на торец покрытия
    const hRoof = f.roofOffset + 0.3;
    const col = dir > 0 ? first : last;
    lc.nodal.push({ node: col.nodes[col.nodes.length - 1], fx: dir * 1.3 * li.wind * li.step * hRoof, fy: 0, mz: 0 });
    return lc;
  }
  const windwardCol = dir > 0 ? first : last;
  const leewardCol = dir > 0 ? last : first;
  const load = (col: ColumnLine, coef: number) => {
    const q = dir * coef * li.wind * li.step;
    for (const idx of col.members) lc.dist.push({ elem: idx, qx: q, qy: 0 });
    // стена выше оголовка колонны (опорная часть фермы)
    lc.nodal.push({ node: col.nodes[col.nodes.length - 1], fx: q * col.wallExtra, fy: 0, mz: 0 });
  };
  load(windwardCol, WALL_WIND.windward);
  load(leewardCol, -WALL_WIND.leeward);
  return lc;
}

function craneCases(f: PlaneFrame, cr: CraneLoads): CaseDef[] {
  const out: CaseDef[] = [];
  for (const sp of f.spans) {
    const cl = f.columns[sp.index];
    const cr2 = f.columns[sp.index + 1];
    for (const heavyLeft of [true, false]) {
      const lc = emptyCase();
      const dL = heavyLeft ? cr.dMax : cr.dMin;
      const dR = heavyLeft ? cr.dMin : cr.dMax;
      if (cr.type === 'bridge') {
        if (cl.craneNode == null || cr2.craneNode == null) continue;
        lc.nodal.push({ node: cl.craneNode, fx: heavyLeft ? -cr.t : 0, fy: -dL, mz: -dL * cr.e });
        lc.nodal.push({ node: cr2.craneNode, fx: heavyLeft ? 0 : cr.t, fy: -dR, mz: dR * cr.e });
      } else {
        if (!sp.suspNodes) continue;
        lc.nodal.push({ node: sp.suspNodes[0], fx: 0, fy: -dL, mz: 0 });
        lc.nodal.push({ node: sp.suspNodes[1], fx: 0, fy: -dR, mz: 0 });
      }
      out.push({
        id: `C${sp.index + 1}${heavyLeft ? 'л' : 'п'}`,
        name: `Кран в пролёте ${sp.index + 1}, тележка ${heavyLeft ? 'слева' : 'справа'}`,
        group: 'C',
        lc,
        toNorm: 1 / GAMMA.crane,
      });
    }
  }
  return out;
}

export interface CaseSet {
  cases: CaseDef[];
  /** нормативная постоянная нагрузка — для прогибов и сочетаний на отрыв */
  deadNorm: LoadCase;
}

export function buildCases(b: Building, f: PlaneFrame, li: LoadInput): CaseSet {
  const cases: CaseDef[] = [];
  cases.push({ id: 'G', name: 'Постоянные и длительные', group: 'G', lc: deadCase(b, f, li, false), toNorm: 1 });
  const mu = snowMu(b.slopeDeg);
  if (li.snow > 0 && mu > 0) {
    cases.push({ id: 'S1', name: 'Снег равномерный', group: 'S', lc: snowCase(f, li, mu, 1, 1), toNorm: 1 / GAMMA.snow });
    if (snowUneven(b.roof, b.slopeDeg)) {
      cases.push({ id: 'S2', name: 'Снег неравномерный, больше справа', group: 'S', lc: snowCase(f, li, mu, 0.75, 1.25), toNorm: 1 / GAMMA.snow });
      cases.push({ id: 'S3', name: 'Снег неравномерный, больше слева', group: 'S', lc: snowCase(f, li, mu, 1.25, 0.75), toNorm: 1 / GAMMA.snow });
    }
  }
  if (li.wind > 0) {
    if (li.canopy) {
      cases.push({ id: 'W1', name: 'Ветер: отрыв покрытия', group: 'W', lc: windCase(b, f, li, 1, CANOPY_WIND.up), toNorm: 1 / GAMMA.wind });
      cases.push({ id: 'W2', name: 'Ветер: прижим покрытия', group: 'W', lc: windCase(b, f, li, 1, CANOPY_WIND.down), toNorm: 1 / GAMMA.wind });
      cases.push({ id: 'W3', name: 'Ветер: отрыв, обратное направление', group: 'W', lc: windCase(b, f, li, -1, CANOPY_WIND.up), toNorm: 1 / GAMMA.wind });
    } else {
      cases.push({ id: 'W1', name: 'Ветер слева', group: 'W', lc: windCase(b, f, li, 1), toNorm: 1 / GAMMA.wind });
      cases.push({ id: 'W2', name: 'Ветер справа', group: 'W', lc: windCase(b, f, li, -1), toNorm: 1 / GAMMA.wind });
    }
  }
  if (li.crane) cases.push(...craneCases(f, li.crane));
  if (f.floorBeams.length && li.floorLive > 0) {
    const lc = emptyCase();
    for (const idx of f.floorBeams) lc.dist.push({ elem: idx, qx: 0, qy: -li.floorLive * li.step });
    cases.push({ id: 'Q', name: 'Полезная на перекрытиях', group: 'Q', lc, toNorm: 1 / li.floorLiveGamma });
  }
  return { cases, deadNorm: deadCase(b, f, li, true) };
}

export interface Combo {
  name: string;
  /** коэффициенты при загружениях (по индексу в cases); G всегда первый */
  coefs: number[];
  /** коэффициент при нормативной постоянной (для сочетаний с минимальной постоянной) */
  deadNorm: number;
}

/**
 * Основные сочетания по п. 6 СП 20: постоянные + кратковременные с коэффициентами
 * 1,0 для первой по влиянию, 0,9 для второй, 0,7 для остальных. Перебираются все
 * варианты выбора первой и второй нагрузки и все варианты загружений в группе.
 */
export function buildCombos(cases: CaseDef[]): Combo[] {
  const groups: CaseGroup[] = ['S', 'W', 'C', 'Q'];
  const byGroup = new Map<CaseGroup, number[]>();
  cases.forEach((c, i) => {
    if (c.group === 'G') return;
    byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), i]);
  });
  const present = groups.filter((g) => byGroup.has(g));
  const combos: Combo[] = [];
  const seen = new Set<string>();
  const add = (name: string, coefs: number[], deadNorm: number) => {
    const key = coefs.map((c) => c.toFixed(2)).join(',') + '|' + deadNorm;
    if (seen.has(key)) return;
    seen.add(key);
    combos.push({ name, coefs, deadNorm });
  };
  const base = () => cases.map((c) => (c.group === 'G' ? 1 : 0));
  add('G', base(), 0);

  const nSub = 1 << present.length;
  for (let mask = 1; mask < nSub; mask++) {
    const used = present.filter((_, i) => mask & (1 << i));
    // порядок влияния: первая (1,0), вторая (0,9), остальные 0,7
    const orders: CaseGroup[][] = [];
    for (const first of used) {
      const rest = used.filter((g) => g !== first);
      if (!rest.length) orders.push([first]);
      for (const second of rest) orders.push([first, second, ...rest.filter((g) => g !== second)]);
    }
    for (const order of orders) {
      const psi = order.map((_, i) => (i === 0 ? 1 : i === 1 ? 0.9 : 0.7));
      // перебор вариантов загружений внутри групп
      const pick = (k: number, coefs: number[], label: string[]) => {
        if (k === order.length) {
          add(['G', ...label].join(' + '), coefs, 0);
          return;
        }
        for (const idx of byGroup.get(order[k])!) {
          const next = [...coefs];
          next[idx] = psi[k];
          pick(k + 1, next, [...label, (psi[k] === 1 ? '' : psi[k].toString().replace('.', ',') + '·') + cases[idx].id]);
        }
      };
      pick(0, base(), []);
    }
  }
  // минимальная постоянная (γf = 0,9) с ветром — отрыв и растяжение в анкерах
  for (const idx of byGroup.get('W') ?? []) {
    const coefs = cases.map(() => 0);
    coefs[idx] = 1;
    add(`0,9·Gн + ${cases[idx].id}`, coefs, 0.9);
  }
  return combos;
}
