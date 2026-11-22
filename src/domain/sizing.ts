// Статический расчёт рамы и подбор сечений по расчётным сочетаниям усилий.

import { checkSection, type CheckResult, type ForceTuple, type MemberCtx, type MemberKind } from './checks';
import { FemModel, forcesAt, type CaseResult, type LoadCase } from './fem';
import {
  GROUP_LABEL,
  buildCases,
  buildCombos,
  type CaseDef,
  type Combo,
  type GroupKey,
  type LoadInput,
  type PlaneFrame,
  type PlaneMember,
} from './frameModel';
import { deflectionLimit } from './loads';
import { E_STEEL, type Section } from './sections';
import type { Building } from './types';

export interface Variant {
  name: string;
  frame: PlaneFrame;
  /** число рам этого типа в здании */
  count: number;
}

export interface GroupCatalog {
  primary: Section[];
  fallback: Section[];
}

export interface SizingOptions {
  Ry: number;
  catalogs: Record<GroupKey, GroupCatalog>;
  /** минимальные размеры поясов и решётки ферм, мм */
  minChord: number;
  minChordT: number;
  minWeb: number;
  driftRatio: number;
  /** предельное использование сечений основных элементов */
  utilLimit: number;
}

export interface ReactionEnvelope {
  nMax: number;
  nMin: number;
  mMax: number;
  nAtM: number;
  qMax: number;
  comboN: string;
  comboM: string;
}

export interface VariantAnalysis {
  variant: Variant;
  cases: CaseDef[];
  combos: Combo[];
  /** расчётные сочетания усилий по стержням */
  tuples: ForceTuple[][];
  /** продольная сила в колоннах при полной вертикальной нагрузке, кН (сжатие > 0) */
  colN: number[];
  reactions: Map<number, ReactionEnvelope>;
  deflection: number;
  drift: number;
  driftHeight: number;
}

export interface GroupCheck {
  section: Section;
  check: CheckResult;
  ctx: MemberCtx;
}

export interface SizingResult {
  sections: Record<GroupKey, Section>;
  checks: Partial<Record<GroupKey, GroupCheck>>;
  analyses: VariantAnalysis[];
  iterations: number;
  deflection: number;
  deflectionLimit: number;
  drift: number;
  driftLimit: number;
  slsOk: boolean;
  warnings: string[];
}

export const GROUP_ORDER: GroupKey[] = [
  'colOuter',
  'colInner',
  'rafter',
  'topChord',
  'botChord',
  'webSup',
  'web',
  'floorBeam',
  'floorPost',
];

const KIND: Record<GroupKey, MemberKind> = {
  colOuter: 'column',
  colInner: 'column',
  topChord: 'chord',
  botChord: 'chord',
  webSup: 'webSupport',
  web: 'web',
  rafter: 'rafter',
  floorBeam: 'floorBeam',
  floorPost: 'post',
};

function stiffness(sec: Section): { EA: number; EI: number } {
  // E в кН/м²; A в м²; I в м⁴
  const E = E_STEEL * 1e4;
  return { EA: E * sec.A * 1e-4, EI: E * sec.Ix * 1e-8 };
}

function analyzeVariant(
  b: Building,
  v: Variant,
  li: Omit<LoadInput, 'massOf'>,
  sections: Record<GroupKey, Section>,
  driftBase: number,
): VariantAnalysis {
  const f = v.frame;
  const { cases, deadNorm } = buildCases(b, f, { ...li, massOf: (g) => sections[g].mass });
  const combos = buildCombos(cases);
  const model = new FemModel(
    f.nodes,
    f.members.map((m) => ({ n1: m.n1, n2: m.n2, rel1: m.rel1, rel2: m.rel2, ...stiffness(sections[m.group]) })),
  );
  const all: LoadCase[] = [...cases.map((c) => c.lc), deadNorm];
  const res: CaseResult[] = all.map((lc) => model.solve(lc));
  const nCase = all.length;
  const nM = f.members.length;

  // значения N, Q, M в трёх сечениях каждого стержня по загружениям
  const vals = res.map((r) => {
    const a = new Float64Array(nM * 9);
    r.elems.forEach((e, i) => {
      [0, e.L / 2, e.L].forEach((x, s) => {
        const st = forcesAt(e, x);
        a[i * 9 + s * 3] = st.N;
        a[i * 9 + s * 3 + 1] = st.Q;
        a[i * 9 + s * 3 + 2] = st.M;
      });
    });
    return a;
  });

  // для каждого стержня и сечения — сочетания с экстремальными N, M, Q
  const CRIT = 5;
  const best = new Float64Array(nM * 3 * CRIT).fill(NaN);
  const bestCombo = new Int32Array(nM * 3 * CRIT).fill(-1);
  const comb = new Float64Array(nM * 9);
  const coefOf = (c: Combo, k: number) => (k < cases.length ? c.coefs[k] : c.deadNorm);

  const supports: number[] = [];
  f.nodes.forEach((n, i) => {
    if (n.fix && n.fix[1]) supports.push(i);
  });
  const reactions = new Map<number, ReactionEnvelope>();
  for (const s of supports) {
    reactions.set(s, { nMax: -Infinity, nMin: Infinity, mMax: 0, nAtM: 0, qMax: 0, comboN: '', comboM: '' });
  }

  combos.forEach((c, ci) => {
    comb.fill(0);
    for (let k = 0; k < nCase; k++) {
      const cf = coefOf(c, k);
      if (!cf) continue;
      const a = vals[k];
      for (let i = 0; i < comb.length; i++) comb[i] += cf * a[i];
    }
    for (let i = 0; i < nM * 3; i++) {
      const N = comb[i * 3];
      const Q = comb[i * 3 + 1];
      const M = comb[i * 3 + 2];
      const crit = [N, -N, M, -M, Math.abs(Q)];
      for (let k = 0; k < CRIT; k++) {
        const idx = i * CRIT + k;
        if (!(best[idx] >= crit[k])) {
          best[idx] = crit[k];
          bestCombo[idx] = ci;
        }
      }
    }
    for (const s of supports) {
      let rx = 0;
      let ry = 0;
      let mz = 0;
      for (let k = 0; k < nCase; k++) {
        const cf = coefOf(c, k);
        if (!cf) continue;
        rx += cf * res[k].reactions[s * 3];
        ry += cf * res[k].reactions[s * 3 + 1];
        mz += cf * res[k].reactions[s * 3 + 2];
      }
      const e = reactions.get(s)!;
      if (ry > e.nMax) {
        e.nMax = ry;
        e.comboN = c.name;
      }
      if (ry < e.nMin) e.nMin = ry;
      if (Math.abs(mz) > e.mMax) {
        e.mMax = Math.abs(mz);
        e.nAtM = ry;
        e.comboM = c.name;
      }
      e.qMax = Math.max(e.qMax, Math.abs(rx));
    }
  });

  // повторно вычисляем усилия для отобранных сочетаний
  const tuples: ForceTuple[][] = f.members.map(() => []);
  const cache = new Map<number, Float64Array>();
  const combined = (ci: number) => {
    let a = cache.get(ci);
    if (!a) {
      a = new Float64Array(nM * 9);
      for (let k = 0; k < nCase; k++) {
        const cf = coefOf(combos[ci], k);
        if (!cf) continue;
        const src = vals[k];
        for (let i = 0; i < a.length; i++) a[i] += cf * src[i];
      }
      cache.set(ci, a);
    }
    return a;
  };
  for (let m = 0; m < nM; m++) {
    const seen = new Set<string>();
    for (let s = 0; s < 3; s++) {
      for (let k = 0; k < CRIT; k++) {
        const ci = bestCombo[(m * 3 + s) * CRIT + k];
        if (ci < 0) continue;
        const key = `${ci}:${s}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = combined(ci);
        tuples[m].push({ N: a[m * 9 + s * 3], Q: a[m * 9 + s * 3 + 1], M: a[m * 9 + s * 3 + 2], combo: combos[ci].name });
      }
    }
  }

  // сжатие в колоннах при полной вертикальной нагрузке (G + первая снеговая)
  const sIdx = cases.findIndex((c) => c.group === 'S');
  const colN = f.columns.map((col) => {
    const m = col.members[0];
    let N = vals[0][m * 9];
    if (sIdx >= 0) N += vals[sIdx][m * 9];
    return Math.max(0, -N);
  });

  // прогиб покрытия от нормативных нагрузок: Gн + Sн
  const dn = res[nCase - 1].disp;
  let deflection = 0;
  const snowIdx = cases.map((c, i) => (c.group === 'S' ? i : -1)).filter((i) => i >= 0);
  const sets = snowIdx.length ? snowIdx : [-1];
  for (const si of sets) {
    const uy = (node: number) => dn[node * 3 + 1] + (si >= 0 ? cases[si].toNorm * res[si].disp[node * 3 + 1] : 0);
    for (const sp of f.spans) {
      const n0 = sp.roofNodes[0];
      const n1 = sp.roofNodes[sp.roofNodes.length - 1];
      const z0 = f.nodes[n0].x;
      const z1 = f.nodes[n1].x;
      for (const nn of sp.roofNodes) {
        const t = (f.nodes[nn].x - z0) / (z1 - z0);
        const chord = uy(n0) + t * (uy(n1) - uy(n0));
        deflection = Math.max(deflection, Math.abs(uy(nn) - chord));
      }
    }
  }

  // горизонтальное смещение верха колонн от нормативного ветра
  let drift = 0;
  cases.forEach((c, i) => {
    if (c.group !== 'W') return;
    for (const col of f.columns) {
      const top = col.nodes[col.nodes.length - 1];
      drift = Math.max(drift, Math.abs(res[i].disp[top * 3]) * c.toNorm);
    }
  });

  return { variant: v, cases, combos, tuples, colN, reactions, deflection, drift, driftHeight: driftBase };
}

/** Коэффициент расчётной длины колонны в плоскости рамы */
function columnMu(
  b: Building,
  f: PlaneFrame,
  colIndex: number,
  colN: number[],
  sectionOf: (g: GroupKey) => Section,
  cand: Section,
): number {
  const col = f.columns[colIndex];
  const groupOf = (i: number): GroupKey => (f.columns[i].outer ? 'colOuter' : 'colInner');
  const myGroup = groupOf(colIndex);
  const secOf = (i: number) => (groupOf(i) === myGroup ? cand : sectionOf(groupOf(i)));
  if (f.scheme === 'truss') {
    // колонны защемлены в фундаментах и связаны шарнирно опёртыми фермами:
    // потеря устойчивости с боковым смещением всей рамы
    let k = 0;
    let p = 0;
    f.columns.forEach((c, i) => {
      k += (Math.PI ** 2 * E_STEEL * secOf(i).Ix) / (4 * (c.clear * 100) ** 3);
      p += colN[i] / (c.clear * 100);
    });
    const n = colN[colIndex];
    if (n < 1 || p <= 0) return 2;
    const alpha = k / p;
    const lef = Math.PI * Math.sqrt((E_STEEL * cand.Ix) / (alpha * n));
    return Math.min(4, Math.max(1, lef / (col.clear * 100)));
  }
  // жёсткая рама (табл. 31 СП 16)
  const cos = Math.cos((b.slopeDeg * Math.PI) / 180);
  const ls = b.width / b.spans / cos;
  const raf = sectionOf('rafter');
  let n = (raf.Ix / ls) / (cand.Ix / col.clear);
  if (!col.outer) n *= 2;
  n = Math.max(n, 0.05);
  const mu = f.baseFix === 'pinned' ? 2 * Math.sqrt(1 + 0.38 / n) : Math.sqrt((n + 0.56) / (n + 0.14));
  return Math.min(4, Math.max(1, mu));
}

/** Шаг раскрепления колонны из плоскости рамы распорками, м */
export function columnBraceSpacing(height: number, family: Section['family']): number {
  const max = family === 'tube' ? 6 : 4.5;
  return height / Math.max(1, Math.ceil(height / max - 1e-6));
}

export function sizeFrame(
  b: Building,
  variants: Variant[],
  li: Omit<LoadInput, 'massOf'>,
  opt: SizingOptions,
): SizingResult {
  const warnings: string[] = [];
  const present = new Set<GroupKey>();
  for (const v of variants) for (const m of v.frame.members) present.add(m.group);

  // стартовые сечения — из середины списков
  const sections = {} as Record<GroupKey, Section>;
  for (const g of GROUP_ORDER) {
    const list = opt.catalogs[g].primary;
    sections[g] = list[Math.min(list.length - 1, Math.floor(list.length / 3))];
  }
  /** нижняя граница ширины поясов: повышается, если решётка не помещается в узел */
  let chordFloor = 0;
  const minIx: Partial<Record<GroupKey, number>> = {};
  const minA: Partial<Record<GroupKey, number>> = {};
  const hf = b.height / Math.max(1, b.floors);
  const cos = Math.cos((b.slopeDeg * Math.PI) / 180);

  const ctxFor = (v: Variant, an: VariantAnalysis, m: PlaneMember, sec: Section): MemberCtx => {
    const f = v.frame;
    const base = { kind: KIND[m.group], Ry: opt.Ry, gammaC: 1 };
    switch (m.group) {
      case 'colOuter':
      case 'colInner': {
        const col = f.columns[m.span];
        let out = columnBraceSpacing(col.height, sec.family);
        if (f.withFloors && f.floorLevels.length) {
          // связевая схема: этажи раскреплены диском перекрытия, верхний ярус — консоль над ним
          const topFloor = f.floorLevels[f.floorLevels.length - 1];
          out = Math.min(out, hf);
          const upper = (f.trussRigid && col.outer ? 1.2 : 2) * (col.clear - topFloor);
          return { ...base, lefIn: Math.max(hf, upper), lefOut: out, lefB: out };
        }
        if (f.sideBraced) return { ...base, lefIn: col.clear, lefOut: out, lefB: out };
        // ферма, закреплённая на колонне в двух уровнях, работает как жёсткий ригель рамы
        const mu =
          f.trussRigid && col.outer
            ? f.baseFix === 'fixed'
              ? 1.2
              : 2.3
            : columnMu(b, f, m.span, an.colN, (g) => sections[g], sec);
        return { ...base, lefIn: mu * col.clear, lefOut: out, lefB: out };
      }
      case 'topChord':
        return { ...base, lefIn: m.len, lefOut: m.len, lefB: m.len };
      case 'botChord':
        return { ...base, lefIn: m.len, lefOut: Math.max(m.len, f.tieSpacing), lefB: m.len };
      case 'webSup':
      case 'web':
        return { ...base, gammaC: 0.95, lefIn: 0.9 * m.len, lefOut: 0.9 * m.len, lefB: m.len };
      case 'rafter':
        return { ...base, lefIn: b.width / b.spans / cos, lefOut: m.len, lefB: 2 * m.len };
      case 'floorBeam':
        return { ...base, lefIn: m.len, lefOut: 2, lefB: 0.5 };
      case 'floorPost':
        return { ...base, lefIn: hf, lefOut: hf, lefB: hf };
    }
  };

  const filterFor = (g: GroupKey) => (s: Section): boolean => {
    if (minIx[g] && s.Ix < minIx[g]!) return false;
    if (minA[g] && s.A < minA[g]!) return false;
    if (g === 'topChord') return s.b >= Math.max(opt.minChord, chordFloor) && s.tw >= opt.minChordT;
    if (g === 'botChord') return s.b >= Math.max(opt.minChord, chordFloor, 0.7 * sections.topChord.b) && s.tw >= opt.minChordT;
    if (g === 'webSup' || g === 'web') {
      // конструктивные соотношения узлов из гнутосварных профилей: решётка не шире пояса
      const chord = Math.min(sections.topChord.b, sections.botChord.b);
      const lo = g === 'webSup' ? 0.5 : 0.4;
      return s.b >= Math.max(opt.minWeb, lo * chord) && s.b <= chord && s.tw <= Math.max(sections.topChord.tw, sections.botChord.tw) + 1;
    }
    return true;
  };

  let analyses: VariantAnalysis[] = [];
  const checks: Partial<Record<GroupKey, GroupCheck>> = {};
  const driftHeight = Math.max(...variants[0].frame.columns.map((c) => c.height));
  // табл. Д.4 СП 20: hs/150 при высоте до 6 м, hs/200 при 15 м, hs/300 при 30 м и более
  const ratio = driftHeight <= 6 ? 150 : driftHeight <= 15 ? 150 + ((driftHeight - 6) / 9) * 50 : Math.min(300, 200 + ((driftHeight - 15) / 15) * 100);
  const driftLimit = driftHeight / Math.max(ratio, opt.driftRatio);
  const deflLimit = deflectionLimit(b.width / b.spans);

  const evalGroup = (g: GroupKey, sec: Section): GroupCheck | null => {
    let worst: GroupCheck | null = null;
    for (const an of analyses) {
      an.variant.frame.members.forEach((m, i) => {
        if (m.group !== g) return;
        const ctx = ctxFor(an.variant, an, m, sec);
        const check = checkSection(sec, ctx, an.tuples[i]);
        if (!worst || check.util > worst.check.util) worst = { section: sec, check, ctx };
      });
    }
    return worst;
  };

  // после нескольких итераций сечения разрешено только увеличивать — иначе подбор может зациклиться
  let growOnly = false;
  const pick = (g: GroupKey): boolean => {
    const base = filterFor(g);
    const current = sections[g];
    const filter = (s: Section) => base(s) && (!growOnly || s.mass >= current.mass - 1e-9);
    for (const list of [opt.catalogs[g].primary, opt.catalogs[g].fallback]) {
      for (const s of list) {
        if (!filter(s)) continue;
        const r = evalGroup(g, s);
        if (r && r.check.util <= opt.utilLimit) {
          const changed = sections[g].id !== s.id;
          sections[g] = s;
          checks[g] = r;
          return changed;
        }
      }
    }
    if ((g === 'webSup' || g === 'web') && chordFloor < 300) {
      // решётка требует более широкого пояса: расширяем пояса и повторяем расчёт
      chordFloor = Math.min(sections.topChord.b, sections.botChord.b) + 20;
      return true;
    }
    // ничего не подошло: берём самое мощное сечение и сообщаем
    const all = [...opt.catalogs[g].primary, ...opt.catalogs[g].fallback].filter(filter);
    const last = all.sort((a, c) => a.Ix - c.Ix)[all.length - 1] ?? sections[g];
    const changed = sections[g].id !== last.id;
    sections[g] = last;
    const r = evalGroup(g, last);
    if (r) checks[g] = r;
    return changed;
  };

  let iterations = 0;
  let deflection = 0;
  let drift = 0;
  let slsOk = true;
  for (let bump = 0; bump < 14; bump++) {
    for (let it = 0; it < 12; it++) {
      iterations++;
      growOnly = it >= 6;
      analyses = variants.map((v) => analyzeVariant(b, v, li, sections, driftHeight));
      let changed = false;
      for (const g of GROUP_ORDER) {
        if (!present.has(g)) continue;
        if (pick(g)) changed = true;
      }
      if (!changed) break;
    }
    deflection = Math.max(...analyses.map((a) => a.deflection));
    drift = Math.max(...analyses.map((a) => a.drift));
    const deflOk = deflection <= deflLimit;
    const driftOk = drift <= driftLimit;
    slsOk = deflOk && driftOk;
    if (slsOk) break;
    // жёсткость недостаточна: поднимаем нижнюю границу момента инерции или площади
    if (!deflOk) {
      const k = Math.min(2, Math.max(1.12, deflection / deflLimit));
      if (present.has('rafter')) minIx.rafter = sections.rafter.Ix * k;
      if (present.has('topChord')) {
        minA.topChord = sections.topChord.A * Math.min(k, 1.35);
        minA.botChord = sections.botChord.A * Math.min(k, 1.35);
      }
    }
    if (!driftOk) {
      const k = Math.min(2, Math.max(1.12, drift / driftLimit));
      // в жёсткой раме смещение зависит и от колонн, и от ригеля — усиливаем оба
      const rigid = present.has('rafter');
      const kc = rigid ? Math.sqrt(k) * 1.03 : k;
      minIx.colOuter = sections.colOuter.Ix * kc;
      if (present.has('colInner')) minIx.colInner = sections.colInner.Ix * kc;
      if (rigid) minIx.rafter = Math.max(minIx.rafter ?? 0, sections.rafter.Ix * kc);
    }
  }

  for (const g of GROUP_ORDER) {
    if (!present.has(g)) continue;
    const c = checks[g];
    if (c && c.check.util > 1.0001) {
      warnings.push(`Не удалось подобрать сечение в сортаменте: ${GROUP_LABEL[g].toLowerCase()} (использование ${(c.check.util * 100).toFixed(0)}%). Требуется индивидуальное решение.`);
    }
  }
  if (!slsOk) {
    if (deflection > deflLimit) warnings.push('Прогиб покрытия превышает предельный: требуется увеличить высоту фермы или сечения.');
    if (drift > driftLimit) warnings.push('Горизонтальное смещение верха колонн превышает предельное: требуется увеличить сечения колонн.');
  }

  return { sections, checks, analyses, iterations, deflection, deflectionLimit: deflLimit, drift, driftLimit, slsOk, warnings };
}
