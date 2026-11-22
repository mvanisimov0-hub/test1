// Расчёт каркаса здания целиком: выбор технологии и схемы, сбор нагрузок,
// расчёт рам, второстепенные элементы, поэлементная модель и ведомость металла.

import { checkSection, phi, type ForceTuple } from './checks';
import {
  GROUP_LABEL,
  buildPlaneFrame,
  trussDepth,
  type CraneLoads,
  type GroupKey,
  type LoadInput,
  type PlaneFrame,
} from './frameModel';
import { frameStep, layoutOpenings, roofRise, spanLength, wallLength } from './geometry';
import { GAMMA, roofWindCoef, snowMu, windPressure, CANOPY_WIND } from './loads';
import {
  CHANNELS,
  E_STEEL,
  IBEAMS,
  IBEAMS_B,
  IBEAMS_COL,
  RECT_TUBES,
  SQUARE_TUBES,
  byMass,
  sectionById,
  steelRy,
  type Section,
} from './sections';
import { GROUP_ORDER, columnBraceSpacing, sizeFrame, type GroupCatalog, type ReactionEnvelope, type Variant } from './sizing';
import type {
  ColumnPoint,
  Element3D,
  ElementRole,
  FoundationLoad,
  GroupResult,
  SecondaryResult,
  SpecPart,
  SpecRow,
  StructureResult,
  Vec3,
} from './structTypes';
import type { BaseFix, CoreType, FrameTech, Project, RoofScheme, WallSide } from './types';

const G = 9.81 / 1000; // кН на кг


const GROUP_MARK: Record<GroupKey, string> = {
  colOuter: 'К1',
  colInner: 'К2',
  topChord: 'Ф',
  botChord: 'Ф',
  webSup: 'Ф',
  web: 'Ф',
  rafter: 'Б1',
  floorBeam: 'БП1',
  floorPost: 'К3',
};

export const MARK_NAME: Record<string, string> = {
  К1: 'Колонна крайнего ряда',
  К2: 'Колонна среднего ряда',
  К3: 'Стойка перекрытия',
  Б1: 'Ригель рамы',
  П1: 'Прогон покрытия',
  Р1: 'Распорка по колоннам',
  Р2: 'Распорка по нижним поясам ферм',
  СВ1: 'Связь вертикальная',
  СВ2: 'Связь вертикальная поперечная',
  СВ3: 'Связь вертикальная в торце',
  СГ1: 'Связь горизонтальная по покрытию',
  ФС1: 'Стойка фахверка',
  РФ1: 'Ригель фахверка',
  ПБ1: 'Подкрановая балка',
  ПП1: 'Путь подвесного крана',
  БП1: 'Главная балка перекрытия',
  БП2: 'Второстепенная балка перекрытия',
  ОП1: 'Обрамление проёмов',
};

/** Вес панели или профлиста, кПа */
export function claddingWeight(kind: 'sandwich' | 'proflist' | 'none', core: CoreType, thk: number): number {
  if (kind === 'none') return 0;
  if (kind === 'proflist') return 0.09;
  const density = core === 'mw' ? 110 : core === 'pir' ? 40 : 20;
  return (9.5 + (density * thk) / 1000) * G;
}

export interface TechDecision {
  tech: FrameTech;
  auto: boolean;
  reasons: string[];
}

/** Границы применения сварной технологии, согласованные с заказчиком */
export const WELDED_LIMITS = { span: 12, height: 8, floors: 2 };

export function resolveTech(p: Project): TechDecision {
  const b = p.building;
  const ls = spanLength(b);
  const against: string[] = [];
  if (ls > WELDED_LIMITS.span) against.push(`пролёт ${ls.toFixed(1).replace('.', ',')} м больше ${WELDED_LIMITS.span} м`);
  if (b.height > WELDED_LIMITS.height) against.push(`высота ${b.height.toFixed(1).replace('.', ',')} м больше ${WELDED_LIMITS.height} м`);
  if (b.floors > WELDED_LIMITS.floors) against.push(`этажей больше ${WELDED_LIMITS.floors}`);
  if (p.frame.crane.type === 'bridge') against.push('опорный мостовой кран');
  const recommended: FrameTech = against.length ? 'kmd' : 'welded';
  if (p.frame.tech === 'auto') {
    return {
      tech: recommended,
      auto: true,
      reasons: against.length
        ? [`Каркас по КМ/КМД на болтовых и сварных соединениях: ${against.join(', ')}.`]
        : [`Сварной каркас: пролёт до ${WELDED_LIMITS.span} м, высота до ${WELDED_LIMITS.height} м, без опорного крана.`],
    };
  }
  const reasons: string[] = [];
  if (p.frame.tech === 'welded' && against.length) {
    reasons.push(`Сварная технология выбрана вручную, хотя по правилам компании рекомендуется КМ/КМД: ${against.join(', ')}.`);
  } else if (p.frame.tech === 'kmd' && !against.length) {
    reasons.push('КМ/КМД выбрана вручную; здание проходит и по сварной технологии — сравните варианты.');
  }
  return { tech: p.frame.tech, auto: false, reasons };
}

export function resolveScheme(p: Project, tech: FrameTech): RoofScheme {
  if (p.frame.roofScheme !== 'auto') return p.frame.roofScheme;
  const ls = spanLength(p.building);
  return ls <= (tech === 'welded' ? 6 : 12) ? 'beam' : 'truss';
}

/** Малые здания со стенами: поперечные нагрузки воспринимают связи покрытия и торцов */
export function isSideBraced(p: Project): boolean {
  return p.envelope.walls !== 'none' && p.building.spans === 1 && p.building.length <= 12.01 && p.frame.crane.type !== 'bridge';
}

/** Ферма крепится к колонне жёстко (в двух уровнях): для сварного каркаса — по умолчанию */
export function resolveTrussRigid(p: Project, tech: FrameTech, scheme: RoofScheme): boolean {
  if (scheme !== 'truss') return false;
  if (p.frame.trussJoint !== 'auto') return p.frame.trussJoint === 'rigid';
  return tech === 'welded';
}

export function resolveBase(p: Project, scheme: RoofScheme, sideBraced: boolean, trussRigid: boolean): BaseFix {
  if (sideBraced) return p.frame.base === 'auto' ? 'pinned' : p.frame.base;
  // фермы на шарнирных опорах не образуют раму — колонны обязательно защемляются
  if (scheme === 'truss' && (!trussRigid || p.building.spans > 1)) return 'fixed';
  if (p.frame.base !== 'auto') return p.frame.base;
  return p.foundation.type === 'screw' ? 'pinned' : 'fixed';
}

function buildCatalogs(p: Project, tech: FrameTech): Record<GroupKey, GroupCatalog> {
  const tubesCol = byMass(SQUARE_TUBES.filter((s) => s.b >= 80));
  const iCol = byMass(IBEAMS_COL);
  let colPrimary = tech === 'welded' ? tubesCol : iCol;
  if (p.frame.columnProfile === 'tube') colPrimary = tubesCol;
  if (p.frame.columnProfile === 'ibeam') colPrimary = iCol;
  if (p.frame.columnProfile === 'auto' && p.frame.crane.type === 'bridge') colPrimary = iCol;
  const colFallback = colPrimary === tubesCol ? iCol : tubesCol;
  const col = { primary: colPrimary, fallback: colFallback };
  const tubesBeam = [...RECT_TUBES, ...SQUARE_TUBES].filter((s) => s.h >= 80);
  const iBeam = byMass([...IBEAMS_B, ...IBEAMS.filter((s) => s.series === 'Ш')]);
  const rafter: GroupCatalog =
    tech === 'welded' ? { primary: byMass([...tubesBeam, ...IBEAMS_B]), fallback: iBeam } : { primary: iBeam, fallback: byMass(tubesBeam) };
  const sq = byMass(SQUARE_TUBES);
  const truss = { primary: sq, fallback: [] as Section[] };
  return {
    colOuter: col,
    colInner: col,
    rafter,
    topChord: truss,
    botChord: truss,
    webSup: truss,
    web: truss,
    floorBeam: { primary: byMass(IBEAMS_B), fallback: byMass(IBEAMS.filter((s) => s.series === 'Ш')) },
    floorPost: { primary: tubesCol, fallback: iCol },
  };
}

function craneLoads(p: Project, step: number): CraneLoads | null {
  const { type, capacity: Q } = p.frame.crane;
  if (type === 'none' || Q <= 0) return null;
  const ls = spanLength(p.building);
  const dyn = GAMMA.crane * 1.1;
  if (type === 'bridge') {
    const gc = (1.2 + 0.4 * Q) * (ls / 16.5) ** 0.7 * (Q > 12.5 ? 1.6 : 1); // масса крана, т
    const fMax = (0.9 * Q + gc / 2) * 9.81;
    const fMin = (0.1 * Q + gc / 2) * 9.81;
    const wheelBase = Math.min(3.6, Math.max(1.8, ls / 7));
    const infl = step > wheelBase ? 1 - wheelBase / (2 * step) : 0.5;
    const beam = 0.8 * step * GAMMA.steel;
    return {
      type,
      dMax: dyn * fMax * infl + beam,
      dMin: dyn * fMin * infl + beam,
      t: GAMMA.crane * 0.05 * 1.15 * Q * 9.81 * infl,
      e: 0.6,
    };
  }
  const gc = (0.5 + 0.2 * Q) * (ls / 12) ** 0.7;
  return {
    type,
    dMax: dyn * (0.85 * Q + gc / 2) * 9.81,
    dMin: dyn * (0.15 * Q + gc / 2) * 9.81,
    t: 0,
    e: 0,
  };
}

interface BeamPick {
  section: Section;
  util: number;
  governs: string;
}

/** Подбор изгибаемого элемента: прочность, устойчивость плоской формы изгиба, прогиб */
function pickBeam(
  catalog: Section[],
  d: { M: number; Q: number; lefB: number; deflK: number; deflLimit: number; Mup?: number; lefBup?: number },
  Ry: number,
): BeamPick {
  let last: BeamPick | null = null;
  for (const s of catalog) {
    const t: ForceTuple[] = [{ N: 0, M: d.M, Q: d.Q, combo: '' }];
    const c = checkSection(s, { kind: 'beam', lefIn: 1, lefOut: 1, lefB: d.lefB, Ry, gammaC: 1 }, t);
    let util = c.util;
    let governs = c.governing;
    if (d.Mup && d.Mup > 0) {
      const cu = checkSection(s, { kind: 'beam', lefIn: 1, lefOut: 1, lefB: d.lefBup ?? d.lefB, Ry, gammaC: 1 }, [
        { N: 0, M: d.Mup, Q: 0, combo: '' },
      ]);
      if (cu.util > util) {
        util = cu.util;
        governs = 'Отрыв ветром: ' + cu.governing.toLowerCase();
      }
    }
    const defl = d.deflK / s.Ix;
    if (defl / d.deflLimit > util) {
      util = defl / d.deflLimit;
      governs = 'Прогиб';
    }
    last = { section: s, util, governs };
    if (util <= 1) return last;
  }
  return last!;
}

/** Подбор стержня связи или распорки на осевую силу */
function pickRod(catalog: Section[], N: number, len: number, lambdaMax: number, Ry: number): BeamPick {
  let last: BeamPick | null = null;
  for (const s of catalog) {
    const lam = (len * 100) / Math.min(s.ix, s.iy);
    let util = lam / lambdaMax;
    let governs = 'Предельная гибкость';
    const strength =
      N >= 0 ? N / (s.A * Ry * 0.9) : -N / (phi(lam * Math.sqrt(Ry / E_STEEL), s.curve) * s.A * Ry);
    if (strength > util) {
      util = strength;
      governs = N >= 0 ? 'Прочность при растяжении' : 'Устойчивость при сжатии';
    }
    last = { section: s, util, governs };
    if (util <= 1) return last;
  }
  return last!;
}

function wallPoint(p: Project, wall: WallSide, u: number, y: number): Vec3 {
  const b = p.building;
  if (wall === 'left') return [u, y, 0];
  if (wall === 'right') return [u, y, b.width];
  if (wall === 'front') return [0, y, u];
  return [b.length, y, u];
}

const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',');

export function calcStructure(p: Project, forceTech?: FrameTech): StructureResult {
  const b = p.building;
  const warnings: string[] = [];
  const decision = resolveTech(p);
  const tech = forceTech ?? decision.tech;
  const scheme = resolveScheme(p, tech);
  const sideBraced = isSideBraced(p);
  const trussRigid = resolveTrussRigid(p, tech, scheme);
  const baseFix = resolveBase(p, scheme, sideBraced, trussRigid);
  const { step, bays, frames } = frameStep(b, p.frame.step);
  const Ls = spanLength(b);
  const B = b.width;
  const L = b.length;
  const H = b.height;
  const nSpans = Math.max(1, b.spans);
  const Ry = steelRy(p.frame.steel);
  const canopy = p.envelope.walls === 'none';
  const alpha = (b.slopeDeg * Math.PI) / 180;
  const cos = Math.cos(alpha);

  // ── нагрузки ──
  const mu = snowMu(b.slopeDeg);
  const snowN = p.site.sg * mu;
  const snow = snowN * GAMMA.snow;
  const riseMax = b.roof === 'mono' ? B * Math.tan(alpha) : (B / 2) * Math.tan(alpha);
  const hTop = H + (scheme === 'truss' ? trussDepth(b) : 0.3) + riseMax;
  const wp = windPressure(p.site.windDistrict, p.site.terrain, hTop, L);
  const maxPurlin = snow > 3.0 ? 2.0 : snow > 2.2 ? 2.5 : 3.0;

  const buildOpts = {
    scheme,
    baseFix,
    craneType: p.frame.crane.type,
    craneCapacity: p.frame.crane.capacity,
    maxPurlin,
    sideBraced,
    trussRigid,
  };
  const typical = buildPlaneFrame(b, { ...buildOpts, withFloors: false });

  const roofPanel = claddingWeight(p.envelope.roofing, p.envelope.roofCore, p.envelope.roofThk);
  const wallPanel = canopy ? 0 : claddingWeight(p.envelope.walls, p.envelope.wallCore, p.envelope.wallThk);

  // ── прогоны ──
  const purlinSpacing = Math.max(...typical.purlinZ.slice(1).map((z, i) => z - typical.purlinZ[i]), 0.5);
  const tribH = Ls / typical.spans[0].panels;
  const rc = roofWindCoef(b.roof, b.slopeDeg);
  const ceUp = canopy ? CANOPY_WIND.up : Math.min(rc.windward, rc.leeward);
  const purlinCatalog =
    tech === 'welded' ? byMass([...RECT_TUBES, ...CHANNELS]) : byMass([...CHANNELS, ...RECT_TUBES.filter((s) => s.h >= 160), ...IBEAMS_B]);
  const lcm = step * 100;
  let purlin = purlinCatalog[0];
  let purlinUtil = 0;
  let purlinGov = '';
  for (let i = 0; i < 2; i++) {
    const self = purlin.mass * G;
    const qn = (snowN * tribH + (roofPanel * tribH) / cos) * cos + self;
    const q = (snow * tribH + (roofPanel * GAMMA.panels * tribH) / cos) * cos + self * GAMMA.steel;
    const qUp = Math.max(0, (-ceUp * wp.w * tribH) / cos - 0.9 * ((roofPanel * tribH) / cos + self));
    const r = pickBeam(
      purlinCatalog,
      {
        M: (q * step * step) / 8,
        Q: (q * step) / 2,
        lefB: 0.6, // сжатая полка раскреплена панелями покрытия
        Mup: (qUp * step * step) / 8,
        lefBup: step > 4.5 ? step / 2 : step,
        deflK: (5 * (qn / 100) * lcm ** 4) / (384 * E_STEEL),
        deflLimit: lcm / 200,
      },
      Ry,
    );
    purlin = r.section;
    purlinUtil = r.util;
    purlinGov = r.governs;
  }
  if (purlinUtil > 1) warnings.push(`Прогоны при шаге рам ${fmt(step)} м не проходят по сортаменту: уменьшите шаг рам или примените решётчатые прогоны.`);
  const purlinH = purlin.h / 1000;
  const purlinsKpa = (purlin.mass * G) / tribH;
  const bracingKpa = 0.03;
  const roofDeadN = roofPanel + purlinsKpa + bracingKpa;
  const roofDead = roofPanel * GAMMA.panels + (purlinsKpa + bracingKpa) * GAMMA.steel;
  const techN = canopy ? 0.05 : 0.1;

  const floorDeadN = 3.8;
  const floorLiveGamma = b.floorLiveKpa < 2 ? 1.3 : 1.2;
  const crane = craneLoads(p, step);

  const li: Omit<LoadInput, 'massOf'> = {
    step,
    roofDeadN,
    roofDead,
    tech: techN * GAMMA.tech,
    techN,
    snow,
    wind: wp.w,
    wall: wallPanel * GAMMA.panels,
    wallN: wallPanel,
    canopy,
    floorDead: floorDeadN * GAMMA.floorDead,
    floorDeadN,
    floorLive: b.floorLiveKpa * floorLiveGamma,
    floorLiveGamma,
    crane,
  };

  // ── типы рам: рядовая и с перекрытиями ──
  const hasFloors = b.floors > 1;
  const floorLen = hasFloors ? Math.min(L, b.floorLength ?? L) : 0;
  const isFloorFrame = (x: number) => hasFloors && x <= floorLen + 1e-6;
  const nFloorFrames = frames.filter(isFloorFrame).length;
  const variants: Variant[] = [];
  let floorFrame: PlaneFrame | null = null;
  if (nFloorFrames < frames.length) variants.push({ name: 'Рядовая рама', frame: typical, count: frames.length - nFloorFrames });
  if (nFloorFrames > 0) {
    floorFrame = buildPlaneFrame(b, { ...buildOpts, withFloors: true });
    variants.push({ name: 'Рама с перекрытиями', frame: floorFrame, count: nFloorFrames });
  }
  const frameAt = (x: number) => (isFloorFrame(x) && floorFrame ? floorFrame : typical);

  const big = Ls > 12;
  let sizing;
  try {
    sizing = sizeFrame(b, variants, li, {
      Ry,
      catalogs: buildCatalogs(p, tech),
      minChord: big ? 80 : 60,
      minChordT: big ? 4 : 3,
      minWeb: big ? 50 : 40,
      driftRatio: p.frame.crane.type === 'bridge' ? 300 : 0,
      utilLimit: 0.95,
    });
  } catch (e) {
    return failed(p, tech, decision, scheme, baseFix, sideBraced, step, bays, frames, e instanceof Error ? e.message : String(e));
  }
  warnings.push(...sizing.warnings);
  const S = sizing.sections;
  const present = new Set<GroupKey>();
  for (const v of variants) for (const m of v.frame.members) present.add(m.group);

  // ── результаты по группам основных элементов ──
  const groups: GroupResult[] = [];
  for (const g of GROUP_ORDER) {
    const c = sizing.checks[g];
    if (!present.has(g) || !c) continue;
    groups.push({
      key: g,
      mark: GROUP_MARK[g],
      label: GROUP_LABEL[g],
      section: c.section.name,
      sectionId: c.section.id,
      util: c.check.util,
      governing: c.check.governing,
      combo: c.check.combo,
      N: c.check.tuple?.N ?? 0,
      M: c.check.tuple?.M ?? 0,
      Q: c.check.tuple?.Q ?? 0,
      lefIn: c.ctx.lefIn,
      lefOut: c.ctx.lefOut,
      lambdaX: c.check.lambdaX,
      lambdaY: c.check.lambdaY,
      items: c.check.items,
    });
  }

  // ── поэлементная модель ──
  const elements: Element3D[] = [];
  const secondary: SecondaryResult[] = [];
  const add = (mark: string, role: ElementRole, sec: Section, a: Vec3, c: Vec3) => {
    elements.push({ mark, role, sectionId: sec.id, a, b: c });
  };
  const roofTopY = (z: number) =>
    scheme === 'truss'
      ? b.roof === 'gable'
        ? H + typical.roofOffset + roofRise(b, z)
        : H + roofRise(b, z) + typical.roofOffset
      : H + roofRise(b, z) + S.rafter.h / 2000;

  const columnPoints: ColumnPoint[] = [];
  for (const x of frames) {
    const f = frameAt(x);
    for (const col of f.columns) {
      const sec = col.outer ? S.colOuter : S.colInner;
      add(col.outer ? 'К1' : 'К2', 'column', sec, [x, 0, col.z], [x, col.height, col.z]);
      columnPoints.push({ x, z: col.z, cls: col.outer ? 'outer' : 'inner' });
    }
    for (const post of f.posts) {
      add('К3', 'column', S.floorPost, [x, 0, post.z], [x, post.height, post.z]);
      columnPoints.push({ x, z: post.z, cls: 'post' });
    }
    for (const sp of f.spans) {
      if (scheme === 'truss') {
        for (const mi of sp.members) {
          const m = f.members[mi];
          const n1 = f.nodes[m.n1];
          const n2 = f.nodes[m.n2];
          add('Ф', 'truss', S[m.group], [x, n1.y, n1.x], [x, n2.y, n2.x]);
        }
      } else {
        // ригель: цельные элементы от опоры до перелома кровли
        let start = sp.roofNodes[0];
        for (let i = 1; i < sp.roofNodes.length; i++) {
          const prev = f.nodes[sp.roofNodes[i - 1]];
          const cur = f.nodes[sp.roofNodes[i]];
          const next = f.nodes[sp.roofNodes[i + 1]];
          const turn = !next || Math.sign(next.y - cur.y) !== Math.sign(cur.y - prev.y);
          if (turn) {
            const s0 = f.nodes[start];
            add('Б1', 'rafter', S.rafter, [x, s0.y, s0.x], [x, cur.y, cur.x]);
            start = sp.roofNodes[i];
          }
        }
      }
    }
    for (const mi of f.floorBeams) {
      const m = f.members[mi];
      const n1 = f.nodes[m.n1];
      const n2 = f.nodes[m.n2];
      add('БП1', 'floor', S.floorBeam, [x, n1.y, n1.x], [x, n2.y, n2.x]);
    }
  }

  // прогоны
  for (let k = 0; k < bays; k++) {
    for (const z of typical.purlinZ) {
      const y = roofTopY(z) + purlinH / 2;
      add('П1', 'purlin', purlin, [frames[k], y, z], [frames[k + 1], y, z]);
    }
  }
  secondary.push({
    key: 'purlin',
    mark: 'П1',
    label: 'Прогоны покрытия',
    section: purlin.name,
    sectionId: purlin.id,
    util: purlinUtil,
    basis: `пролёт ${fmt(step)} м, шаг ${fmt(purlinSpacing, 2)} м; ${purlinGov.toLowerCase()}`,
    count: bays * typical.purlinZ.length,
    length: step,
  });

  // ── продольные связи и распорки ──
  const tubes = byMass(SQUARE_TUBES);
  const endArea = B * (H + typical.roofOffset) + (b.roof === 'mono' ? (B * riseMax) / 2 : (B * riseMax) / 2);
  const roofLevelForce = canopy ? Math.max(5, 1.3 * wp.w * B * (typical.roofOffset + riseMax + 0.3)) : (1.3 * wp.w * endArea) / 2;
  const craneLong = crane && crane.type === 'bridge' ? 0.1 * crane.dMax : 0;
  const lineForce = (roofLevelForce * (nSpans > 1 ? Ls : Ls / 2)) / B + craneLong;

  // связевые блоки: крайние шаги, свободные от ворот и дверей
  const fakhverkCount = Math.max(0, Math.ceil(Ls / 6 - 1e-6) - 1);
  const endStops: number[] = [0];
  for (let sIdx = 0; sIdx < nSpans; sIdx++) {
    for (let q = 1; q <= fakhverkCount + 1; q++) endStops.push(sIdx * Ls + (q * Ls) / (fakhverkCount + 1));
  }
  const layout = layoutOpenings(b, p.openings, canopy ? undefined : { left: frames, right: frames, front: endStops, back: endStops });
  warnings.push(...layout.warnings);
  const bayFree = (wall: WallSide, k: number) =>
    !layout.items.some(
      (o) => o.wall === wall && o.opening.kind !== 'window' && o.u < frames[k + 1] - 0.05 && o.u + o.w > frames[k] + 0.05,
    );
  const wanted = bays <= 2 ? [0] : bays <= 14 ? [0, bays - 1] : [0, Math.floor(bays / 2), bays - 1];
  const braceBaysFor = (wall: WallSide | null): { bays: number[]; portal: boolean } => {
    if (!wall || canopy) return { bays: wanted, portal: false };
    const result: number[] = [];
    for (const w of wanted) {
      let found = -1;
      for (let d = 0; d < bays && found < 0; d++) {
        for (const k of [w + d, w - d]) {
          if (k >= 0 && k < bays && !result.includes(k) && bayFree(wall, k)) {
            found = k;
            break;
          }
        }
      }
      if (found >= 0) result.push(found);
    }
    if (!result.length) return { bays: wanted, portal: true };
    return { bays: result, portal: false };
  };

  const colHeights = typical.columns.map((c) => c.height);
  const hBrace = Math.max(...colHeights);
  const tiers = hBrace / step > 1.6 ? 2 : 1;
  const braceLen = Math.hypot(step, hBrace / tiers);
  const nBraced = wanted.length;
  const brace = pickRod(tubes.filter((s) => s.b >= 50), lineForce / nBraced / (step / braceLen), braceLen, 300, Ry);
  let portalNote = false;
  let braceCount = 0;
  typical.columns.forEach((col) => {
    const wall: WallSide | null = col.side === -1 ? 'left' : col.side === 1 ? 'right' : null;
    const bb = braceBaysFor(wall);
    if (bb.portal) portalNote = true;
    for (const k of bb.bays) {
      const ht = col.height / tiers;
      for (let t = 0; t < tiers; t++) {
        add('СВ1', 'brace', brace.section, [frames[k], t * ht, col.z], [frames[k + 1], (t + 1) * ht, col.z]);
        add('СВ1', 'brace', brace.section, [frames[k + 1], t * ht, col.z], [frames[k], (t + 1) * ht, col.z]);
        braceCount += 2;
      }
    }
  });
  if (portalNote) {
    warnings.push('Проёмы занимают все шаги продольной стены: вместо крестовых связей нужны портальные (рамные) связи — уточняется при разработке КМ.');
  }
  secondary.push({
    key: 'vbrace',
    mark: 'СВ1',
    label: 'Связи вертикальные по колоннам',
    section: brace.section.name,
    sectionId: brace.section.id,
    util: brace.util,
    basis: `усилие на ряд ${fmt(lineForce)} кН, длина ${fmt(braceLen, 2)} м; ${brace.governs.toLowerCase()}`,
    count: braceCount,
    length: braceLen,
  });

  // распорки по верху колонн и промежуточные
  const strut = pickRod(tubes.filter((s) => s.b >= 60), -lineForce, step, 200, Ry);
  let strutCount = 0;
  typical.columns.forEach((col) => {
    const sec = col.outer ? S.colOuter : S.colInner;
    const sp = columnBraceSpacing(col.height, sec.family);
    const levels = Math.round(col.height / sp);
    for (let lv = 1; lv <= levels; lv++) {
      const y = lv === levels ? col.height : lv * sp;
      for (let k = 0; k < bays; k++) {
        add('Р1', 'strut', strut.section, [frames[k], y, col.z], [frames[k + 1], y, col.z]);
        strutCount++;
      }
    }
  });
  secondary.push({
    key: 'strut',
    mark: 'Р1',
    label: 'Распорки по колоннам',
    section: strut.section.name,
    sectionId: strut.section.id,
    util: strut.util,
    basis: `длина ${fmt(step)} м, усилие ${fmt(lineForce)} кН; ${strut.governs.toLowerCase()}`,
    count: strutCount,
    length: step,
  });

  if (scheme === 'truss' && typical.tieZ.length) {
    const tie = pickRod(tubes.filter((s) => s.b >= 50), -0.02 * 200, step, 200, Ry);
    for (const z of typical.tieZ) {
      const y = b.roof === 'gable' ? H : H + roofRise(b, z);
      for (let k = 0; k < bays; k++) add('Р2', 'strut', tie.section, [frames[k], y, z], [frames[k + 1], y, z]);
    }
    secondary.push({
      key: 'tie',
      mark: 'Р2',
      label: 'Распорки по нижним поясам ферм',
      section: tie.section.name,
      sectionId: tie.section.id,
      util: tie.util,
      basis: `длина ${fmt(step)} м; ${tie.governs.toLowerCase()}`,
      count: typical.tieZ.length * bays,
      length: step,
    });
  }

  // горизонтальные связи по покрытию в связевых шагах
  {
    const cells = Math.max(1, Math.round(Ls / step));
    const cellW = Ls / cells;
    const diag = Math.hypot(step, cellW / cos);
    const windTruss = (0.8 * wp.w * endArea) / 2;
    const hb = pickRod(tubes.filter((s) => s.b >= 50), windTruss / 2 / (step / diag), diag, 300, Ry);
    let count = 0;
    const roofBays = sideBraced ? frames.slice(1).map((_, k) => k) : wanted;
    for (const k of roofBays) {
      for (let s = 0; s < nSpans; s++) {
        for (let c = 0; c < cells; c++) {
          const z1 = s * Ls + c * cellW;
          const z2 = z1 + cellW;
          add('СГ1', 'brace', hb.section, [frames[k], roofTopY(z1), z1], [frames[k + 1], roofTopY(z2), z2]);
          add('СГ1', 'brace', hb.section, [frames[k + 1], roofTopY(z1), z1], [frames[k], roofTopY(z2), z2]);
          count += 2;
        }
      }
    }
    secondary.push({
      key: 'hbrace',
      mark: 'СГ1',
      label: 'Связи горизонтальные по покрытию',
      section: hb.section.name,
      sectionId: hb.section.id,
      util: hb.util,
      basis: `длина ${fmt(diag, 2)} м; ${hb.governs.toLowerCase()}`,
      count,
      length: diag,
    });
  }

  // ── связи в торцах при связевой схеме ──
  if (sideBraced) {
    const force = (1.3 * wp.w * L * (H + typical.roofOffset + riseMax / 2)) / 4;
    let count = 0;
    let len = 0;
    let section = tubes[0];
    let util = 0;
    let governs = '';
    let blocked = false;
    for (const wall of ['front', 'back'] as WallSide[]) {
      const busy = layout.items
        .filter((o) => o.wall === wall && o.opening.kind !== 'window')
        .map((o) => [o.u - 0.1, o.u + o.w + 0.1])
        .sort((q1, q2) => q1[0] - q2[0]);
      // самый широкий свободный участок стены
      let best: [number, number] = [0, 0];
      let cur = 0;
      for (const [u1, u2] of [...busy, [B, B]]) {
        if (u1 - cur > best[1] - best[0]) best = [cur, u1];
        cur = Math.max(cur, u2);
      }
      const width = Math.min(best[1] - best[0], Math.max(3, 1.5 * H));
      if (width < 1) {
        blocked = true;
        continue;
      }
      const z1 = best[0];
      const z2 = z1 + width;
      len = Math.hypot(width, H);
      const r = pickRod(tubes.filter((s) => s.b >= 50), force / (width / len), len, 300, Ry);
      section = r.section;
      util = r.util;
      governs = r.governs;
      const x = wall === 'front' ? 0 : L;
      add('СВ3', 'brace', r.section, [x, 0, z1], [x, H, z2]);
      add('СВ3', 'brace', r.section, [x, 0, z2], [x, H, z1]);
      count += 2;
    }
    if (blocked) warnings.push('В торце нет свободного участка стены для вертикальной связи: поперечную устойчивость нужно обеспечить рамами — задайте жёсткое опирание колонн и уточните при разработке КМ.');
    if (count) {
      secondary.push({
        key: 'endbrace',
        mark: 'СВ3',
        label: 'Связи вертикальные в торцах',
        section: section.name,
        sectionId: section.id,
        util,
        basis: `усилие ${fmt(force)} кН, длина ${fmt(len, 2)} м; ${governs.toLowerCase()}`,
        count,
        length: len,
      });
    }
  }

  // ── фахверк и ригели стен ──
  if (!canopy) {
    const postCatalog = byMass([...SQUARE_TUBES.filter((s) => s.b >= 80), ...RECT_TUBES.filter((s) => s.h >= 100), ...IBEAMS_B]);
    const m = Math.max(0, Math.ceil(Ls / 6 - 1e-6) - 1);
    const a = Ls / (m + 1);
    const posts: { z: number; h: number }[] = [];
    for (let s = 0; s < nSpans; s++) for (let q = 1; q <= m; q++) posts.push({ z: s * Ls + q * a, h: roofTopY(s * Ls + q * a) });
    if (posts.length) {
      const hMax = Math.max(...posts.map((q) => q.h));
      const q = wp.w * 1.0 * a;
      const qn = wp.wn * 1.0 * a;
      const hc = hMax * 100;
      const fp = pickBeam(
        postCatalog,
        { M: (q * hMax * hMax) / 8, Q: (q * hMax) / 2, lefB: 3, deflK: (5 * (qn / 100) * hc ** 4) / (384 * E_STEEL), deflLimit: hc / 200 },
        Ry,
      );
      let placed = 0;
      for (const [x, wall] of [[0, 'front'], [L, 'back']] as [number, WallSide][]) {
        for (const post of posts) {
          // стойка, попадающая в проём ворот, не ставится: её заменяет обрамление проёма
          const inGate = layout.items.some((o) => o.wall === wall && o.opening.kind !== 'window' && post.z > o.u + 0.05 && post.z < o.u + o.w - 0.05);
          if (inGate) continue;
          add('ФС1', 'fakhverk', fp.section, [x, 0, post.z], [x, post.h, post.z]);
          columnPoints.push({ x, z: post.z, cls: 'fakhverk' });
          placed++;
        }
      }
      secondary.push({
        key: 'fakhverk',
        mark: 'ФС1',
        label: 'Стойки торцевого фахверка',
        section: fp.section.name,
        sectionId: fp.section.id,
        util: fp.util,
        basis: `высота до ${fmt(hMax)} м, шаг ${fmt(a)} м; ${fp.governs.toLowerCase()}`,
        count: placed,
        length: hMax,
      });
    }

    // ригели: при вертикальной раскладке панелей или обшивке профлистом
    const girtSpacing = p.envelope.walls === 'proflist' ? 1.8 : p.envelope.wallLayout === 'vertical' ? 3.0 : 0;
    if (girtSpacing > 0) {
      const hWall = H + typical.roofOffset;
      const rows = Math.max(1, Math.ceil(hWall / girtSpacing - 1e-6));
      const girtCatalog = tech === 'welded' ? byMass(RECT_TUBES) : byMass([...CHANNELS, ...RECT_TUBES]);
      const span = Math.max(step, a);
      const sc = span * 100;
      const q = wp.w * (hWall / rows);
      const qn = wp.wn * (hWall / rows);
      const gp = pickBeam(
        girtCatalog,
        { M: (q * span * span) / 8, Q: (q * span) / 2, lefB: span / 2, deflK: (5 * (qn / 100) * sc ** 4) / (384 * E_STEEL), deflLimit: sc / 200 },
        Ry,
      );
      let count = 0;
      const zStops = [0];
      for (let s = 0; s < nSpans; s++) for (let q2 = 1; q2 <= m + 1; q2++) zStops.push(s * Ls + q2 * a);
      for (let r = 1; r <= rows; r++) {
        const y = (r * hWall) / rows;
        for (const z of [0, B]) {
          for (let k = 0; k < bays; k++) {
            add('РФ1', 'girt', gp.section, [frames[k], y, z], [frames[k + 1], y, z]);
            count++;
          }
        }
        for (const x of [0, L]) {
          for (let i = 0; i < zStops.length - 1; i++) {
            add('РФ1', 'girt', gp.section, [x, y, zStops[i]], [x, y, zStops[i + 1]]);
            count++;
          }
        }
      }
      secondary.push({
        key: 'girt',
        mark: 'РФ1',
        label: 'Ригели фахверка',
        section: gp.section.name,
        sectionId: gp.section.id,
        util: gp.util,
        basis: `пролёт ${fmt(span)} м, шаг по высоте ${fmt(hWall / rows, 2)} м; ${gp.governs.toLowerCase()}`,
        count,
        length: span,
      });
    }

    // обрамление проёмов
    const frameSec = (w: number, kind: string) =>
      kind === 'gate'
        ? sectionById(w <= 3.5 ? 'T100x100x4' : w <= 5 ? 'T120x120x5' : 'T160x160x5')
        : kind === 'door'
          ? sectionById('T80x80x3')
          : sectionById('T60x60x3');
    for (const o of layout.items) {
      const sec = frameSec(o.w, o.opening.kind);
      const top = o.sill + o.h;
      const lim = wallLength(b, o.wall);
      const u1 = Math.max(0, o.u);
      const u2 = Math.min(lim, o.u + o.w);
      const y0 = o.opening.kind === 'window' ? o.sill : 0;
      const yTop = o.opening.kind === 'window' ? top : top + 0.3;
      add('ОП1', 'opening', sec, wallPoint(p, o.wall, u1, y0), wallPoint(p, o.wall, u1, yTop));
      add('ОП1', 'opening', sec, wallPoint(p, o.wall, u2, y0), wallPoint(p, o.wall, u2, yTop));
      add('ОП1', 'opening', sec, wallPoint(p, o.wall, u1, top), wallPoint(p, o.wall, u2, top));
      if (o.opening.kind === 'window') add('ОП1', 'opening', sec, wallPoint(p, o.wall, u1, o.sill), wallPoint(p, o.wall, u2, o.sill));
    }
  }

  // ── подкрановые конструкции ──
  if (crane) {
    const cat = byMass([...IBEAMS_B, ...IBEAMS.filter((s) => s.series === 'Ш')]);
    const sc = step * 100;
    if (crane.type === 'bridge' && typical.craneLevel != null) {
      const wheelBase = Math.min(3.6, Math.max(1.8, Ls / 7));
      const F = (crane.dMax - 0.8 * step * GAMMA.steel) / Math.max(0.5, 1 - wheelBase / (2 * step)) / 2;
      const M =
        wheelBase < 0.586 * step ? (F / (2 * step)) * (step - wheelBase / 2) ** 2 : (F * step) / 4;
      const Fn = F / (GAMMA.crane * 1.1);
      const cb = pickBeam(
        cat,
        { M: M * 1.05, Q: F * 1.6, lefB: step, deflK: ((2 * Fn * sc ** 3) / (48 * E_STEEL)) * 0.85, deflLimit: sc / 400 },
        Ry,
      );
      let count = 0;
      for (let s = 0; s < nSpans; s++) {
        for (const z of [s * Ls + crane.e, (s + 1) * Ls - crane.e]) {
          for (let k = 0; k < bays; k++) {
            add('ПБ1', 'crane', cb.section, [frames[k], typical.craneLevel, z], [frames[k + 1], typical.craneLevel, z]);
            count++;
          }
        }
      }
      secondary.push({
        key: 'craneBeam',
        mark: 'ПБ1',
        label: 'Подкрановые балки',
        section: cb.section.name,
        sectionId: cb.section.id,
        util: cb.util,
        basis: `пролёт ${fmt(step)} м, давление колеса ${fmt(F)} кН; ${cb.governs.toLowerCase()}`,
        count,
        length: step,
      });
    } else if (crane.type === 'suspended') {
      const P = crane.dMax;
      const Pn = P / (GAMMA.crane * 1.1);
      const mr = pickBeam(cat, { M: (P * step) / 4, Q: P, lefB: step, deflK: (Pn * sc ** 3) / (48 * E_STEEL), deflLimit: sc / 400 }, Ry);
      let count = 0;
      for (const sp of typical.spans) {
        if (!sp.suspNodes) continue;
        for (const nn of sp.suspNodes) {
          const node = typical.nodes[nn];
          for (let k = 0; k < bays; k++) {
            add('ПП1', 'crane', mr.section, [frames[k], node.y - 0.15, node.x], [frames[k + 1], node.y - 0.15, node.x]);
            count++;
          }
        }
      }
      secondary.push({
        key: 'monorail',
        mark: 'ПП1',
        label: 'Пути подвесного крана',
        section: mr.section.name,
        sectionId: mr.section.id,
        util: mr.util,
        basis: `пролёт ${fmt(step)} м, нагрузка ${fmt(P)} кН; ${mr.governs.toLowerCase()}`,
        count,
        length: step,
      });
    }
  }

  // ── поперечные связи каркаса с перекрытиями ──
  if (floorFrame && floorFrame.floorLevels.length) {
    const floorX = frames.filter(isFloorFrame);
    const hfl = floorFrame.floorLevels[0];
    const zNext = floorFrame.posts.length ? Math.min(...floorFrame.posts.map((q) => q.z)) : Ls;
    const len = Math.hypot(zNext, hfl);
    const force = (1.3 * wp.w * step * hfl * floorX.length) / 2;
    const tb = pickRod(tubes.filter((s) => s.b >= 60), force / (zNext / len), len, 300, Ry);
    const planes = floorX.length > 1 ? [floorX[0], floorX[floorX.length - 1]] : [floorX[0]];
    let count = 0;
    for (const x of planes) {
      for (const z0 of [0, B - zNext]) {
        let y0 = 0;
        for (const lv of floorFrame.floorLevels) {
          add('СВ2', 'brace', tb.section, [x, y0, z0], [x, lv, z0 + zNext]);
          add('СВ2', 'brace', tb.section, [x, y0, z0 + zNext], [x, lv, z0]);
          count += 2;
          y0 = lv;
        }
      }
    }
    secondary.push({
      key: 'tbrace',
      mark: 'СВ2',
      label: 'Связи поперечные под перекрытиями',
      section: tb.section.name,
      sectionId: tb.section.id,
      util: tb.util,
      basis: `усилие ${fmt(force)} кН, длина ${fmt(len, 2)} м; ${tb.governs.toLowerCase()}`,
      count,
      length: len,
    });
  }

  // ── второстепенные балки перекрытий ──
  if (floorFrame && floorFrame.floorLevels.length) {
    const mPosts = Math.max(0, Math.ceil(Ls / 6 - 1e-6) - 1);
    const seg = Ls / (mPosts + 1);
    const nSec = Math.max(1, Math.ceil(seg / 2 - 1e-6));
    const sp = seg / nSec;
    const cat = byMass([...IBEAMS_B, ...CHANNELS]);
    const q = (li.floorDead + li.floorLive) * sp;
    const qn = (floorDeadN + b.floorLiveKpa) * sp;
    const sc = step * 100;
    const fb = pickBeam(
      cat,
      { M: (q * step * step) / 8, Q: (q * step) / 2, lefB: 0.5, deflK: (5 * (qn / 100) * sc ** 4) / (384 * E_STEEL), deflLimit: sc / 250 },
      Ry,
    );
    const floorFramesX = frames.filter(isFloorFrame);
    let count = 0;
    const lines = nSpans * (mPosts + 1) * nSec + 1;
    for (const lv of floorFrame.floorLevels) {
      for (let i = 0; i < lines; i++) {
        const z = i * sp;
        for (let k = 0; k < floorFramesX.length - 1; k++) {
          add('БП2', 'floor', fb.section, [floorFramesX[k], lv, z], [floorFramesX[k + 1], lv, z]);
          count++;
        }
      }
    }
    if (count) {
      secondary.push({
        key: 'floorSecondary',
        mark: 'БП2',
        label: 'Второстепенные балки перекрытий',
        section: fb.section.name,
        sectionId: fb.section.id,
        util: fb.util,
        basis: `пролёт ${fmt(step)} м, шаг ${fmt(sp, 2)} м; ${fb.governs.toLowerCase()}`,
        count,
        length: step,
      });
    }
  }

  // ── ведомость элементов ──
  const spec: SpecRow[] = [];
  const grouped = new Map<string, SpecRow>();
  for (const e of elements) {
    if (e.role === 'truss') continue;
    const sec = sectionById(e.sectionId);
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1], e.b[2] - e.a[2]);
    const key = `${e.mark}|${e.sectionId}|${len.toFixed(2)}`;
    const row = grouped.get(key);
    if (row) {
      row.count++;
      row.massTotal += sec.mass * len;
    } else {
      grouped.set(key, {
        mark: e.mark,
        name: MARK_NAME[e.mark] ?? e.mark,
        section: sec.name,
        family: sec.family,
        length: len,
        count: 1,
        massEach: sec.mass * len,
        massTotal: sec.mass * len,
        assembly: false,
      });
    }
  }
  // фермы — сборочные единицы
  let trussMass = 0;
  if (scheme === 'truss') {
    const signatures = new Map<string, { parts: Map<string, SpecPart>; spans: number; len: number }>();
    for (const sp of typical.spans) {
      const d0 = typical.nodes[sp.roofNodes[0]].y - typical.nodes[sp.bottomNodes[0]].y;
      const d1 =
        typical.nodes[sp.roofNodes[sp.roofNodes.length - 1]].y - typical.nodes[sp.bottomNodes[sp.bottomNodes.length - 1]].y;
      const sig = [Math.min(d0, d1), Math.max(d0, d1)].map((v) => v.toFixed(2)).join('/');
      let entry = signatures.get(sig);
      if (!entry) {
        entry = { parts: new Map(), spans: 0, len: Ls };
        signatures.set(sig, entry);
      }
      entry.spans++;
      if (entry.spans > 1) continue;
      for (const mi of sp.members) {
        const m = typical.members[mi];
        const sec = S[m.group];
        const name = GROUP_LABEL[m.group];
        const part = entry.parts.get(m.group) ?? { name, section: sec.name, family: sec.family, length: 0, mass: 0 };
        part.length += m.len;
        part.mass += m.len * sec.mass;
        entry.parts.set(m.group, part);
      }
    }
    let n = 1;
    for (const entry of signatures.values()) {
      const parts = [...entry.parts.values()];
      const massEach = parts.reduce((s, q) => s + q.mass, 0);
      const count = entry.spans * frames.length;
      trussMass += massEach * count;
      spec.push({
        mark: `Ф${n++}`,
        name: 'Ферма стропильная',
        section: parts.map((q) => q.section.replace('Труба ', '')).filter((v, i, arr) => arr.indexOf(v) === i).join(' / '),
        family: 'tube',
        length: entry.len,
        count,
        massEach,
        massTotal: massEach * count,
        assembly: true,
        parts,
        note: entry.len > 13.5 ? 'поставка двумя отправочными марками' : undefined,
      });
    }
  }
  const order = ['К1', 'К2', 'К3', 'Б1', 'П1', 'Р1', 'Р2', 'СВ1', 'СВ2', 'СВ3', 'СГ1', 'ФС1', 'РФ1', 'ПБ1', 'ПП1', 'БП1', 'БП2', 'ОП1'];
  const rows = [...grouped.values()].sort(
    (r1, r2) => order.indexOf(r1.mark) - order.indexOf(r2.mark) || r2.length - r1.length,
  );
  const colRows = rows.filter((r) => r.mark.startsWith('К'));
  const restRows = rows.filter((r) => !r.mark.startsWith('К'));
  spec.unshift(...colRows);
  spec.push(...restRows);

  const mass = { total: 0, tube: 0, ibeam: 0, channel: 0, plate: 0, truss: trussMass, kgPerM2: 0 };
  for (const r of spec) {
    if (r.parts) for (const q of r.parts) mass[q.family] += q.mass * r.count;
    else if (r.family === 'tube' || r.family === 'ibeam' || r.family === 'channel') mass[r.family] += r.massTotal;
  }
  const base = mass.tube + mass.ibeam + mass.channel;
  mass.plate = base * (tech === 'welded' ? 0.04 : 0.07);
  spec.push({
    mark: '—',
    name: 'Узловые детали: фасонки, опорные плиты, рёбра, фланцы (укрупнённо)',
    section: 'Лист',
    family: 'plate',
    length: 0,
    count: 1,
    massEach: mass.plate,
    massTotal: mass.plate,
    assembly: false,
  });
  mass.total = base + mass.plate;
  mass.kgPerM2 = mass.total / (L * B);

  // ── нагрузки на фундаменты ──
  const foundationLoads: FoundationLoad[] = [];
  const classes: { cls: FoundationLoad['cls']; label: string }[] = [
    { cls: 'outer', label: 'Колонны крайних рядов' },
    { cls: 'inner', label: 'Колонны средних рядов' },
    { cls: 'post', label: 'Стойки перекрытия' },
  ];
  for (const { cls, label } of classes) {
    const env: ReactionEnvelope = { nMax: -Infinity, nMin: Infinity, mMax: 0, nAtM: 0, qMax: 0, comboN: '', comboM: '' };
    let found = false;
    for (const an of sizing.analyses) {
      const f = an.variant.frame;
      const nodesOf =
        cls === 'post' ? f.posts.map((q) => q.nodes[0]) : f.columns.filter((c) => (cls === 'outer' ? c.outer : !c.outer)).map((c) => c.nodes[0]);
      for (const nn of nodesOf) {
        const r = an.reactions.get(nn);
        if (!r) continue;
        found = true;
        if (r.nMax > env.nMax) {
          env.nMax = r.nMax;
          env.comboN = r.comboN;
        }
        env.nMin = Math.min(env.nMin, r.nMin);
        if (r.mMax > env.mMax) {
          env.mMax = r.mMax;
          env.nAtM = r.nAtM;
          env.comboM = r.comboM;
        }
        env.qMax = Math.max(env.qMax, r.qMax);
      }
    }
    if (!found) continue;
    foundationLoads.push({ cls, label, count: columnPoints.filter((c) => c.cls === cls).length, ...env });
  }

  // ── схема рядовой рамы для чертежа разреза ──
  const drawFrame = floorFrame && nFloorFrames === frames.length ? floorFrame : typical;
  const roleOf: Record<string, string> = {
    column: 'column',
    top: 'truss',
    bottom: 'truss',
    vertical: 'web',
    diagonal: 'web',
    rafter: 'rafter',
    floorBeam: 'floor',
    post: 'column',
  };
  const section2d = {
    members: (floorFrame ?? drawFrame).members.map((m) => {
      const f = floorFrame ?? drawFrame;
      return {
        z1: f.nodes[m.n1].x,
        y1: f.nodes[m.n1].y,
        z2: f.nodes[m.n2].x,
        y2: f.nodes[m.n2].y,
        role: roleOf[m.part],
        sectionId: S[m.group].id,
      };
    }),
  };

  // ── предупреждения ──
  if (Ls > 36) warnings.push(`Пролёт ${fmt(Ls)} м больше 36 м: рекомендуется добавить ряд промежуточных колонн.`);
  if (scheme === 'beam' && Ls > 18) warnings.push('Балочная схема при пролёте более 18 м неэкономична: рассмотрите фермы.');
  if (scheme === 'truss' && typical.roofOffset + (b.spans === 1 ? riseMax : Ls * Math.tan(alpha)) > 3.8) {
    warnings.push('Высота фермы превышает транспортный габарит 3,8 м: потребуется укрупнительная сборка на площадке или меньший уклон.');
  }
  if (p.foundation.type === 'screw' && baseFix === 'fixed') {
    warnings.push('Колонны защемлены в фундаментах, а винтовые сваи плохо воспринимают момент: заложены кусты свай. Для крупных зданий рекомендуется столбчатый или буронабивной фундамент.');
  }
  if (step > 6.5 && !canopy && p.envelope.walls === 'sandwich' && p.envelope.wallLayout === 'horizontal') {
    warnings.push(`Шаг рам ${fmt(step)} м больше предельного пролёта стеновых панелей (6 м): нужны промежуточные стойки фахверка или вертикальная раскладка.`);
  }
  if (b.floors > 1 && scheme === 'truss' && H / b.floors < 2.7) warnings.push('Высота этажа меньше 2,7 м: проверьте заданную высоту здания.');

  const braceV = lineForce / nBraced;
  const assumptions = [
    'Расчёт поперечной рамы — плоская стержневая система, метод конечных элементов; усилия от сочетаний нагрузок по п. 6 СП 20.13330.',
    'Снеговая нагрузка: коэффициенты ce = 1, ct = 1 (без учёта сноса снега ветром и снеговых мешков у перепадов высот).',
    'Ветровая нагрузка: осреднённые аэродинамические коэффициенты, без выделения местных зон у карнизов и углов; пульсационная составляющая учтена по п. 11.1.8.',
    'Устойчивость сжато-изгибаемых элементов в плоскости рамы проверена с увеличением момента 1/(1 − N/Ncr).',
    'Узлы (базы колонн, фланцевые стыки, узлы ферм из гнутосварных профилей) не рассчитываются; масса узловых деталей принята укрупнённо.',
    'Каркас с перекрытиями — связевая схема: перекрытие считается жёстким диском, горизонтальные нагрузки передаются на вертикальные связи.',
    'Здания длиной до 12 м — связевая схема: поперечные нагрузки передаются связями покрытия на связи в торцах, колонны опёрты шарнирно.',
    'Сварной каркас: фермы крепятся к крайним колоннам в уровнях верхнего и нижнего поясов (жёсткое сопряжение); каркас по КМ/КМД — шарнирное опирание ферм на защемлённые колонны.',
    'Торцевые рамы приняты такими же, как рядовые. Сейсмика, температурные воздействия и огнестойкость не рассматриваются.',
    'Расчёт предварительный: служит основанием для КП и задания на проектирование, до сверки с конструктором не заменяет раздел КМ.',
  ];

  return {
    ok: true,
    error: null,
    tech,
    techAuto: decision.auto && !forceTech,
    techReasons: decision.reasons,
    scheme,
    baseFix,
    sideBraced,
    step,
    bays,
    frames,
    spanLen: Ls,
    roofOffset: scheme === 'truss' ? typical.roofOffset : S.rafter.h / 2000,
    purlinH,
    loads: {
      sg: p.site.sg,
      mu,
      snowN,
      snow,
      w0: wp.w0,
      k: wp.k,
      zeta: wp.zeta,
      nu: wp.nu,
      windN: wp.wn,
      wind: wp.w,
      roofPanel,
      purlins: purlinsKpa,
      roofDeadN,
      roofDead,
      tech: techN,
      wall: wallPanel,
      floorDeadN: hasFloors ? floorDeadN : 0,
      floorLiveN: hasFloors ? b.floorLiveKpa : 0,
      crane: crane ? { dMax: crane.dMax, dMin: crane.dMin, t: crane.t } : null,
    },
    cases: sizing.analyses[sizing.analyses.length - 1].cases.map((c) => ({ id: c.id, name: c.name })),
    comboCount: Math.max(...sizing.analyses.map((a) => a.combos.length)),
    iterations: sizing.iterations,
    groups,
    secondary,
    sls: {
      deflection: sizing.deflection,
      deflectionLimit: sizing.deflectionLimit,
      drift: sizing.drift,
      driftLimit: sizing.driftLimit,
      ok: sizing.slsOk,
    },
    foundationLoads,
    braceReaction: { horizontal: braceV, vertical: (braceV * hBrace) / step },
    trussRigid,
    openings: layout.items,
    elements,
    spec,
    columns: columnPoints,
    mass,
    section2d,
    warnings,
    assumptions,
  };
}

function failed(
  p: Project,
  tech: FrameTech,
  decision: TechDecision,
  scheme: RoofScheme,
  baseFix: BaseFix,
  sideBraced: boolean,
  step: number,
  bays: number,
  frames: number[],
  error: string,
): StructureResult {
  return {
    ok: false,
    error,
    tech,
    techAuto: decision.auto,
    techReasons: decision.reasons,
    scheme,
    baseFix,
    sideBraced,
    step,
    bays,
    frames,
    spanLen: spanLength(p.building),
    roofOffset: 0.3,
    purlinH: 0.15,
    loads: {
      sg: p.site.sg, mu: 1, snowN: 0, snow: 0, w0: 0, k: 0, zeta: 0, nu: 0, windN: 0, wind: 0, roofPanel: 0, purlins: 0,
      roofDeadN: 0, roofDead: 0, tech: 0, wall: 0, floorDeadN: 0, floorLiveN: 0, crane: null,
    },
    cases: [],
    comboCount: 0,
    iterations: 0,
    groups: [],
    secondary: [],
    sls: { deflection: 0, deflectionLimit: 0, drift: 0, driftLimit: 0, ok: false },
    foundationLoads: [],
    braceReaction: { horizontal: 0, vertical: 0 },
    trussRigid: false,
    openings: [],
    elements: [],
    spec: [],
    columns: [],
    mass: { total: 0, tube: 0, ibeam: 0, channel: 0, plate: 0, truss: 0, kgPerM2: 0 },
    section2d: { members: [] },
    warnings: [`Расчёт рамы не выполнен: ${error}`],
    assumptions: [],
  };
}
