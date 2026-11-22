// Фундаменты: подбор размеров и количества по нагрузкам от каркаса.
// Грунт задан одним числом — расчётным сопротивлением R0; без изысканий это оценка для КП.

import type { EnvelopeGeometry } from './geometry';
import type { FoundationLoad, StructureResult } from './structTypes';
import type { Project } from './types';

export interface FoundationItem {
  priceId: string;
  name: string;
  qty: number;
  unit: string;
  note?: string;
}

export interface FoundationResult {
  type: Project['foundation']['type'];
  title: string;
  /** описание решения по классам колонн */
  details: string[];
  items: FoundationItem[];
  concrete: number;
  piles: number;
  warnings: string[];
}

export const FOUNDATION_LABEL: Record<Project['foundation']['type'], string> = {
  screw: 'Винтовые сваи',
  pads: 'Столбчатые монолитные фундаменты',
  bored: 'Буронабивные сваи с ростверками',
  slab: 'Монолитная плита',
  customer: 'Фундамент заказчика',
};

const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
const up = (v: number, step: number) => Math.ceil(v / step - 1e-9) * step;

interface ClassLoad {
  label: string;
  count: number;
  N: number;
  M: number;
  Nmin: number;
}

function classLoads(st: StructureResult): ClassLoad[] {
  const out: ClassLoad[] = st.foundationLoads.map((f: FoundationLoad) => ({
    label: f.label.toLowerCase(),
    count: f.count,
    N: Math.max(0, f.nMax),
    M: f.mMax,
    Nmin: f.nMin,
  }));
  const fakh = st.columns.filter((c) => c.cls === 'fakhverk').length;
  if (fakh) out.push({ label: 'стойки фахверка', count: fakh, N: 25, M: 0, Nmin: 0 });
  return out;
}

/** Число свай в кусте под колонну: вертикальная нагрузка, момент и отрыв */
function pileGroup(N: number, M: number, Nmin: number, cap: number, pull: number, spacing: number, maxN: number): number {
  for (let n = 1; n <= maxN; n++) {
    const arm = n === 1 ? 0 : (spacing * n) / 2;
    if (n === 1 && M > 5) continue; // одиночная свая момент не воспринимает
    const pMax = N / n + (arm ? M / arm : 0);
    const pMin = Nmin / n - (arm ? M / arm : 0);
    if (pMax <= cap && pMin >= -pull) return n;
  }
  return maxN;
}

export function calcFoundation(p: Project, st: StructureResult, geo: EnvelopeGeometry): FoundationResult {
  const type = p.foundation.type;
  const b = p.building;
  const frost = p.site.frostDepth;
  const R0 = Math.max(80, p.site.soilR0);
  const loads = classLoads(st);
  const items: FoundationItem[] = [];
  const details: string[] = [];
  const warnings: string[] = [];
  const hasWalls = p.envelope.walls !== 'none';
  const mainCols = st.columns.filter((c) => c.cls === 'outer' || c.cls === 'inner').length;
  const lightCols = st.columns.length - mainCols;
  let concrete = 0;
  let piles = 0;

  const anchors = () => {
    if (mainCols) items.push({ priceId: 'found.anchor', name: 'Анкерные группы колонн', qty: mainCols, unit: 'компл' });
    if (lightCols) items.push({ priceId: 'found.anchor.light', name: 'Анкерные болты стоек фахверка и перекрытий', qty: lightCols, unit: 'компл' });
  };

  if (type === 'customer') {
    details.push('Фундаменты выполняет заказчик по заданию с нагрузками от каркаса. В смету входят анкерные группы.');
    anchors();
    return { type, title: FOUNDATION_LABEL[type], details, items, concrete, piles, warnings };
  }

  if (type === 'pads') {
    const depth = Math.min(3, Math.max(1.0, up(frost + 0.1, 0.1)));
    let earth = 0;
    for (const c of loads) {
      const Nn = c.N / 1.2;
      const Mn = c.M / 1.3;
      let a = c.label.includes('фахверк') || c.label.includes('перекрыт') ? 0.8 : 1.0;
      for (; a < 4.5; a += 0.1) {
        const own = a * a * depth * 20;
        const pAvg = (Nn + own) / (a * a);
        const pMax = pAvg + (6 * Mn) / a ** 3;
        const e = Mn / (Nn + own);
        if (pAvg <= R0 && pMax <= 1.2 * R0 && e <= a / 6) break;
      }
      a = Math.round(a * 10) / 10;
      const hp = a <= 1.5 ? 0.3 : a <= 2.4 ? 0.4 : 0.5;
      const ped = a >= 1.8 ? 0.6 : 0.5;
      const v = a * a * hp + ped * ped * Math.max(0.3, depth - hp + 0.15);
      concrete += v * c.count;
      earth += (a + 1) ** 2 * depth * c.count;
      details.push(`Под ${c.label}: подошва ${fmt(a)}×${fmt(a)} м, глубина заложения ${fmt(depth)} м — ${c.count} шт. (N = ${fmt(c.N, 0)} кН, M = ${fmt(c.M, 0)} кН·м).`);
      if (a >= 4) warnings.push(`Фундамент под ${c.label} получился больше 4 м: при таком грунте рассмотрите сваи.`);
    }
    if (hasWalls) {
      const v = geo.perimeter * 0.25 * 0.45;
      concrete += v;
      earth += geo.perimeter * 0.6 * 0.6;
      details.push(`Фундаментные балки 250×450 мм по периметру под стеновое ограждение — ${fmt(geo.perimeter, 0)} м.`);
    }
    items.push({ priceId: 'found.earth', name: 'Земляные работы под фундаменты', qty: earth, unit: 'м³' });
    items.push({ priceId: 'found.concrete', name: 'Столбчатые фундаменты и фундаментные балки', qty: concrete, unit: 'м³' });
    anchors();
  }

  if (type === 'bored') {
    const len = Math.max(3, up(frost + 1.5, 0.5));
    const cap = 90 + 15 * (len - 3);
    let length = 0;
    let caps = 0;
    for (const c of loads) {
      const n = pileGroup(c.N, c.M, c.Nmin, cap, 40, 0.9, 8);
      piles += n * c.count;
      length += n * c.count * len;
      const vCap = n === 1 ? 0.18 : n === 2 ? 0.45 : n <= 4 ? 1.13 : 2.16;
      caps += vCap * c.count;
      details.push(`Под ${c.label}: ${n} ${n === 1 ? 'свая' : n < 5 ? 'сваи' : 'свай'} 300 мм длиной ${fmt(len)} м с ростверком — ${c.count} шт.`);
      if (n >= 8) warnings.push(`Под ${c.label} требуется больше 8 свай: нужен индивидуальный расчёт фундамента.`);
    }
    let beams = 0;
    if (hasWalls) {
      beams = geo.perimeter * 0.3 * 0.5;
      details.push(`Ростверк-балка 300×500 мм по периметру — ${fmt(geo.perimeter, 0)} м.`);
    }
    concrete = caps + beams;
    items.push({ priceId: 'found.bored', name: `Буронабивные сваи 300 мм, ${piles} шт.`, qty: length, unit: 'м.п.' });
    items.push({ priceId: 'found.earth', name: 'Земляные работы под ростверки', qty: concrete * 2.5, unit: 'м³' });
    items.push({ priceId: 'found.concrete', name: 'Ростверки монолитные', qty: concrete, unit: 'м³' });
    anchors();
  }

  if (type === 'screw') {
    const len = Math.max(2.5, up(frost + 1.0, 0.5));
    let n108 = 0;
    let n133 = 0;
    for (const c of loads) {
      const light = c.N <= 40 && c.M <= 5;
      const cap = light ? 40 : 70;
      const n = pileGroup(c.N, c.M, c.Nmin, cap, light ? 15 : 25, 0.6, 6);
      if (light) n108 += n * c.count;
      else n133 += n * c.count;
      details.push(`Под ${c.label}: ${n} ${n === 1 ? 'свая' : n < 5 ? 'сваи' : 'свай'} ${light ? 108 : 133} мм длиной ${fmt(len)} м — ${c.count} шт.`);
      if (c.N > 250) warnings.push(`Нагрузка на ${c.label} ${fmt(c.N, 0)} кН велика для винтовых свай: рекомендуется столбчатый или буронабивной фундамент.`);
    }
    // промежуточные сваи под обвязку, чтобы шаг опор не превышал 3 м
    let extra = 0;
    if (hasWalls) {
      extra += 2 * st.bays * Math.max(0, Math.ceil(st.step / 3 - 1e-6) - 1);
      const endSeg = st.spanLen / (Math.max(0, Math.ceil(st.spanLen / 6 - 1e-6) - 1) + 1);
      extra += 2 * b.spans * (Math.round(st.spanLen / endSeg)) * Math.max(0, Math.ceil(endSeg / 3 - 1e-6) - 1);
      n108 += extra;
      details.push(`Обвязка швеллером по периметру — ${fmt(geo.perimeter, 0)} м${extra ? `, промежуточных свай 108 мм — ${extra} шт.` : ''}.`);
    }
    piles = n108 + n133;
    if (n108) items.push({ priceId: 'found.screw.108', name: `Сваи винтовые 108 мм длиной ${fmt(len)} м`, qty: n108, unit: 'шт' });
    if (n133) items.push({ priceId: 'found.screw.133', name: `Сваи винтовые 133 мм длиной ${fmt(len)} м`, qty: n133, unit: 'шт' });
    if (hasWalls) items.push({ priceId: 'found.screw.binding', name: 'Обвязка свай швеллером', qty: geo.perimeter, unit: 'м.п.' });
  }

  if (type === 'slab') {
    const maxN = Math.max(0, ...loads.map((c) => c.N));
    const t = maxN <= 100 && st.spanLen <= 9 ? 0.2 : maxN <= 250 ? 0.25 : 0.3;
    const area = (b.length + 0.6) * (b.width + 0.6);
    const ribs = mainCols * 0.2;
    concrete = area * t + ribs;
    details.push(`Плита толщиной ${Math.round(t * 1000)} мм на площади ${fmt(area, 0)} м² с утолщениями под колонны, по песчано-щебёночной подготовке.`);
    details.push('Плита служит полом здания.');
    items.push({ priceId: 'found.earth', name: 'Земляные работы под плиту', qty: area * 0.5, unit: 'м³' });
    items.push({ priceId: 'found.prep', name: 'Песчано-щебёночная подготовка', qty: area, unit: 'м²' });
    if (b.heated) items.push({ priceId: 'found.insulation', name: 'Утепление под плитой', qty: area, unit: 'м²' });
    items.push({ priceId: 'found.slab', name: `Монолитная плита ${Math.round(t * 1000)} мм`, qty: concrete, unit: 'м³' });
    anchors();
    const maxM = Math.max(0, ...loads.map((c) => c.M));
    if (maxM > 60) warnings.push('Колонны передают на плиту значительные моменты: потребуются усиленные утолщения под колоннами, уточняется расчётом КЖ.');
  }

  return { type, title: FOUNDATION_LABEL[type], details, items, concrete, piles, warnings };
}
