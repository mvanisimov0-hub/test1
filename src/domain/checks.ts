// Проверки стальных элементов по СП 16.13330.2017.
// Единицы: усилия кН и кН·м, сечения в см, напряжения кН/см².
//
// Принятые упрощения (перечислены в расчётной записке):
// - устойчивость внецентренно сжатых элементов в плоскости действия момента проверяется
//   по формуле с увеличением момента 1/(1 − N/Ncr) вместо таблиц φe (п. 9.2.2);
// - узлы ферм из гнутосварных профилей не рассчитываются, вместо этого соблюдаются
//   конструктивные соотношения размеров пояса и решётки;
// - местная устойчивость проверяется только для стенок замкнутых профилей.

import { E_STEEL, type Section } from './sections';

export type MemberKind = 'column' | 'chord' | 'web' | 'webSupport' | 'rafter' | 'floorBeam' | 'post' | 'beam';

export interface ForceTuple {
  N: number;
  M: number;
  Q: number;
  combo: string;
}

export interface MemberCtx {
  kind: MemberKind;
  /** расчётная длина в плоскости рамы и из плоскости, м */
  lefIn: number;
  lefOut: number;
  /** расстояние между точками раскрепления сжатого пояса при изгибе, м */
  lefB: number;
  Ry: number;
  gammaC: number;
}

export interface CheckItem {
  name: string;
  util: number;
}

export interface CheckResult {
  util: number;
  governing: string;
  combo: string;
  items: CheckItem[];
  /** гибкости для записки */
  lambdaX: number;
  lambdaY: number;
  tuple: ForceTuple | null;
}

/** Коэффициент устойчивости при центральном сжатии φ (п. 7.1.3, формула (8)) */
export function phi(lambdaBar: number, curve: 'a' | 'b' | 'c'): number {
  const p = { a: [0.03, 0.06, 0.4, 3.8], b: [0.04, 0.09, 0.4, 4.4], c: [0.04, 0.14, 0.4, 5.8] }[curve];
  const [alpha, beta, lowLimit, highLimit] = p;
  if (lambdaBar <= lowLimit) return 1;
  if (lambdaBar > highLimit) return 7.6 / (lambdaBar * lambdaBar);
  const delta = 9.87 * (1 - alpha + beta * lambdaBar) + lambdaBar * lambdaBar;
  const v = (0.5 * (delta - Math.sqrt(Math.max(0, delta * delta - 39.48 * lambdaBar * lambdaBar)))) / (lambdaBar * lambdaBar);
  return Math.min(1, v);
}

/** Коэффициент устойчивости при изгибе φb для двутавров и швеллеров (прил. Ж) */
export function phiB(sec: Section, lef: number, Ry: number): number {
  if (sec.family === 'tube') return 1;
  const l = lef * 100;
  const h = sec.h / 10;
  if (l <= 0) return 1;
  const alpha = 1.54 * (sec.It / sec.Iy) * (l / h) ** 2;
  let psi: number;
  if (alpha <= 40) psi = 2.25 + 0.07 * alpha;
  else psi = 3.6 + 0.04 * alpha - 3.5e-5 * alpha * alpha;
  let phi1 = psi * (sec.Iy / sec.Ix) * (h / l) ** 2 * (E_STEEL / Ry);
  if (sec.family === 'channel') phi1 *= 0.7;
  return phi1 <= 0.85 ? phi1 : Math.min(1, 0.68 + 0.21 * phi1);
}

function slendernessLimit(kind: MemberKind, alpha: number): number {
  const a = Math.min(1, Math.max(0.5, alpha));
  if (kind === 'web') return 210 - 60 * a;
  return 180 - 60 * a;
}

/** Проверка сечения на набор расчётных сочетаний усилий. util ≤ 1 — сечение проходит. */
export function checkSection(sec: Section, ctx: MemberCtx, tuples: ForceTuple[]): CheckResult {
  const { Ry, gammaC } = ctx;
  const R = Ry * gammaC;
  const lamX = (ctx.lefIn * 100) / sec.ix;
  const lamY = (ctx.lefOut * 100) / sec.iy;
  const kBar = Math.sqrt(Ry / E_STEEL);
  const phiX = phi(lamX * kBar, sec.curve);
  const phiY = phi(lamY * kBar, sec.curve);
  const phiMin = Math.min(phiX, phiY);
  const fb = ctx.kind === 'web' || ctx.kind === 'webSupport' ? 1 : phiB(sec, ctx.lefB, Ry);
  const nCrX = (Math.PI ** 2 * E_STEEL * sec.Ix) / (ctx.lefIn * 100) ** 2;
  const bending = ctx.kind === 'rafter' || ctx.kind === 'floorBeam' || ctx.kind === 'beam';

  const best: Record<string, { util: number; combo: string; tuple: ForceTuple }> = {};
  const put = (name: string, util: number, t: ForceTuple) => {
    if (!best[name] || util > best[name].util) best[name] = { util, combo: t.combo, tuple: t };
  };

  let compressed = false;
  for (const t of tuples) {
    const N = t.N;
    const M = Math.abs(t.M) * 100; // кН·см
    const sN = Math.abs(N) / sec.A;
    const sM = M / sec.Wx;
    put('Прочность (N/A + M/W)', (sN + sM) / R, t);
    put('Срез стенки', Math.abs(t.Q) / (sec.Aw * 0.58 * R), t);
    if (M > 0 && fb < 1) put('Устойчивость плоской формы изгиба', sM / (fb * R), t);

    if (N < 0) {
      const Nc = -N;
      const significant = Nc > 0.02 * sec.A * Ry;
      if (significant) compressed = true;
      put('Устойчивость при сжатии', Nc / (phiMin * sec.A * R), t);
      if (M > 0) {
        const amp = 1 - Nc / nCrX;
        const inPlane = amp <= 0.05 ? 99 : Nc / (phiX * sec.A * R) + sM / (amp * R);
        put('Устойчивость в плоскости рамы (сжатие с изгибом)', inPlane, t);
        // из плоскости: коэффициент c по п. 9.2.5
        const mx = (M / Nc) * (sec.A / sec.Wx);
        let c: number;
        if (sec.family === 'tube') {
          c = 1 / (1 + 0.6 * Math.min(mx, 10));
        } else {
          const c5 = 1 / (1 + (0.65 + 0.05 * 5) * 5);
          const c10 = 1 / (1 + (10 * phiY) / Math.max(fb, 0.05));
          if (mx <= 5) c = 1 / (1 + (mx <= 1 ? 0.7 : 0.65 + 0.05 * mx) * mx);
          else if (mx >= 10) c = 1 / (1 + (mx * phiY) / Math.max(fb, 0.05));
          else c = c5 * (2 - 0.2 * mx) + c10 * (0.2 * mx - 1);
        }
        put('Устойчивость из плоскости рамы', Nc / (c * phiY * sec.A * R), t);
      }
      if (significant && !bending) {
        const alpha = Nc / (phiMin * sec.A * R);
        put('Предельная гибкость', Math.max(lamX, lamY) / slendernessLimit(ctx.kind, alpha), t);
      }
    }
  }

  const any = tuples[0];
  if (any) {
    if (!compressed && !bending) put('Предельная гибкость', Math.max(lamX, lamY) / 400, any);
    if (sec.family === 'tube') {
      // местная устойчивость стенки замкнутого профиля (табл. 9, 13)
      const flat = Math.max(sec.h, sec.b) - 3 * sec.tw;
      const lamW = (flat / sec.tw) * kBar;
      const lim = compressed ? Math.min(1.6, Math.max(1.2, 1.2 + 0.35 * Math.max(lamX, lamY) * kBar)) : 2.3;
      put('Местная устойчивость стенки', lamW / lim, any);
    }
  }

  let util = 0;
  let governing = '';
  let combo = '';
  let tuple: ForceTuple | null = null;
  const items: CheckItem[] = [];
  for (const [name, v] of Object.entries(best)) {
    items.push({ name, util: v.util });
    if (v.util > util) {
      util = v.util;
      governing = name;
      combo = v.combo;
      tuple = v.tuple;
    }
  }
  items.sort((a, b) => b.util - a.util);
  return { util, governing, combo, items, lambdaX: lamX, lambdaY: lamY, tuple };
}

/** Самое лёгкое сечение из списка, проходящее проверку; null — ничего не подошло */
export function pickLightest(
  catalog: Section[],
  ctxFor: (s: Section) => MemberCtx,
  tuples: ForceTuple[],
  filter?: (s: Section) => boolean,
  limit = 1,
): { section: Section; check: CheckResult } | null {
  for (const s of catalog) {
    if (filter && !filter(s)) continue;
    const check = checkSection(s, ctxFor(s), tuples);
    if (check.util <= limit) return { section: s, check };
  }
  return null;
}
