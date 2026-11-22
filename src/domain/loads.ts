// Нагрузки и воздействия по СП 20.13330.2016.
// Здесь только нормативные таблицы и формулы; сбор нагрузок на раму — в frameModel.ts.

import type { RoofShape, Terrain } from './types';

/** Табл. 10.1: нормативный вес снегового покрова Sg по снеговым районам, кПа */
export const SNOW_SG: Record<number, number> = {
  1: 0.5,
  2: 1.0,
  3: 1.5,
  4: 2.0,
  5: 2.5,
  6: 3.0,
  7: 3.5,
  8: 4.0,
};

export const SNOW_DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8];
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/** Табл. 11.1: нормативное ветровое давление w0 по ветровым районам, кПа */
export const WIND_W0: Record<string, number> = {
  Ia: 0.17,
  I: 0.23,
  II: 0.3,
  III: 0.38,
  IV: 0.48,
  V: 0.6,
  VI: 0.73,
  VII: 0.85,
};

export const WIND_DISTRICTS = ['Ia', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Коэффициенты надёжности по нагрузке */
export const GAMMA = {
  snow: 1.4,
  wind: 1.4,
  steel: 1.05,
  panels: 1.2,
  floorDead: 1.2,
  tech: 1.2,
  crane: 1.2,
};

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

const Z_K = [5, 10, 20, 40, 60];
const K_TABLE: Record<Terrain, number[]> = {
  A: [0.75, 1.0, 1.25, 1.5, 1.7],
  B: [0.5, 0.65, 0.85, 1.1, 1.3],
  C: [0.4, 0.4, 0.55, 0.8, 1.0],
};
const ZETA_TABLE: Record<Terrain, number[]> = {
  A: [0.85, 0.76, 0.69, 0.62, 0.58],
  B: [1.22, 1.06, 0.92, 0.8, 0.74],
  C: [1.78, 1.78, 1.5, 1.26, 1.14],
};

/** Табл. 11.2: коэффициент изменения ветрового давления по высоте k(ze) */
export function windK(terrain: Terrain, z: number): number {
  return interp(Z_K, K_TABLE[terrain], z);
}

/** Табл. 11.4: коэффициент пульсации давления ветра ζ(ze) */
export function windZeta(terrain: Terrain, z: number): number {
  return interp(Z_K, ZETA_TABLE[terrain], z);
}

const NU_RHO = [0.1, 5, 10, 20, 40, 80, 160];
const NU_CHI = [5, 10, 20, 40, 80, 160];
const NU_TABLE = [
  [0.95, 0.92, 0.88, 0.83, 0.76, 0.67],
  [0.89, 0.87, 0.84, 0.8, 0.73, 0.65],
  [0.85, 0.84, 0.81, 0.77, 0.71, 0.64],
  [0.8, 0.78, 0.76, 0.73, 0.68, 0.61],
  [0.72, 0.72, 0.7, 0.67, 0.63, 0.57],
  [0.63, 0.63, 0.61, 0.59, 0.56, 0.51],
  [0.53, 0.53, 0.52, 0.5, 0.47, 0.44],
];

/** Табл. 11.6: коэффициент пространственной корреляции пульсаций ν(ρ, χ) */
export function windNu(rho: number, chi: number): number {
  const rows = NU_TABLE.map((row) => interp(NU_CHI, row, chi));
  return interp(NU_RHO, rows, rho);
}

export interface WindPressure {
  w0: number;
  k: number;
  zeta: number;
  nu: number;
  /** нормативное давление при c = 1 с учётом пульсационной составляющей, кПа */
  wn: number;
  /** расчётное давление при c = 1, кПа */
  w: number;
}

/**
 * Ветровое давление на здание высотой h при аэродинамическом коэффициенте c = 1.
 * rho — размер наветренной поверхности поперёк потока, м.
 */
export function windPressure(district: string, terrain: Terrain, h: number, rho: number): WindPressure {
  const w0 = WIND_W0[district] ?? WIND_W0.II;
  const ze = Math.max(h, 5);
  const k = windK(terrain, ze);
  const zeta = windZeta(terrain, ze);
  const nu = windNu(rho, h);
  const wn = w0 * k * (1 + zeta * nu);
  return { w0, k, zeta, nu, wn, w: wn * GAMMA.wind };
}

/** Коэффициент формы μ для одно- и двускатных покрытий (схема Б.1) */
export function snowMu(slopeDeg: number): number {
  if (slopeDeg <= 30) return 1;
  if (slopeDeg >= 60) return 0;
  return (60 - slopeDeg) / 30;
}

/** Нужен ли вариант неравномерного снега 0,75μ / 1,25μ (схема Б.1, вариант 2) */
export function snowUneven(roof: RoofShape, slopeDeg: number): boolean {
  return roof === 'gable' && slopeDeg >= 15 && slopeDeg <= 40;
}

/**
 * Осреднённые аэродинамические коэффициенты покрытия (прил. В.1.2, В.1.3).
 * Местные зоны F, G у карнизов и углов не выделяются — это уровень расчёта рамы.
 */
export function roofWindCoef(roof: RoofShape, slopeDeg: number): { windward: number; leeward: number } {
  if (roof === 'mono') {
    if (slopeDeg <= 15) return { windward: -0.7, leeward: -0.7 };
    return { windward: 0.3, leeward: -0.8 };
  }
  if (slopeDeg <= 10) return { windward: -0.6, leeward: -0.5 };
  if (slopeDeg <= 20) return { windward: -0.3, leeward: -0.5 };
  if (slopeDeg <= 30) return { windward: 0.3, leeward: -0.5 };
  return { windward: 0.6, leeward: -0.5 };
}

export const WALL_WIND = { windward: 0.8, leeward: -0.5 };

/** Навес без стен: суммарные коэффициенты давления на покрытие (отрыв и прижим) */
export const CANOPY_WIND = { up: -1.0, down: 0.4 };

/** Предельный вертикальный прогиб покрытия в долях пролёта (табл. Д.1) */
export function deflectionLimit(span: number): number {
  const ratio = interp([1, 3, 6, 24, 36], [120, 150, 200, 250, 300], span);
  return span / ratio;
}
