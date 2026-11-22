// Теплотехника ограждающих конструкций по СП 50.13330.2012:
// требуемое сопротивление теплопередаче и подбор толщины сэндвич-панелей.

import type { Building, BuildingType, CoreType, Envelope, Site } from './types';

export const PANEL_THICKNESS = [50, 60, 80, 100, 120, 150, 170, 200, 250];

/** Расчётная теплопроводность утеплителя (условия эксплуатации Б), Вт/(м·°C) */
export const LAMBDA: Record<CoreType, number> = { mw: 0.045, pir: 0.024, eps: 0.041 };

export const CORE_LABEL: Record<CoreType, string> = {
  mw: 'минеральная вата',
  pir: 'PIR',
  eps: 'пенополистирол',
};

export type ThermalClass = 'public' | 'industrial';

const PUBLIC: BuildingType[] = ['shop', 'abk'];

export function thermalClass(type: BuildingType): ThermalClass {
  return PUBLIC.includes(type) ? 'public' : 'industrial';
}

/** Коэффициенты a, b табл. 3 СП 50.13330.2012 */
const AB: Record<ThermalClass, { wall: [number, number]; roof: [number, number] }> = {
  public: { wall: [0.0003, 1.2], roof: [0.0004, 1.6] },
  industrial: { wall: [0.0002, 1.0], roof: [0.00025, 1.5] },
};

export function panelR(core: CoreType, thk: number): number {
  return 1 / 8.7 + thk / 1000 / LAMBDA[core] + 1 / 23;
}

export interface ThermalPart {
  rReq: number;
  /** допустимый минимум при выполнении комплексного требования (п. 5.2): 0,63 для стен, 0,8 для покрытий */
  rMin: number;
  rFact: number;
  thk: number;
  recommended: number;
  status: 'ok' | 'reduced' | 'low' | 'na';
}

export interface ThermalResult {
  heated: boolean;
  cls: ThermalClass;
  gsop: number;
  wall: ThermalPart;
  roof: ThermalPart;
  notes: string[];
}

export function gsop(site: Site, tInside: number): number {
  return Math.max(0, (tInside - site.tHeat) * site.zHeat);
}

export function recommendThickness(core: CoreType, rReq: number): number {
  for (const t of PANEL_THICKNESS) if (panelR(core, t) >= rReq - 0.005) return t;
  return PANEL_THICKNESS[PANEL_THICKNESS.length - 1];
}

function part(core: CoreType, thk: number, rReq: number, k: number, applicable: boolean): ThermalPart {
  const rFact = panelR(core, thk);
  const rMin = rReq * k;
  const status = !applicable ? 'na' : rFact >= rReq - 0.005 ? 'ok' : rFact >= rMin ? 'reduced' : 'low';
  return { rReq, rMin, rFact, thk, recommended: recommendThickness(core, rReq), status };
}

export function calcThermal(b: Building, env: Envelope, site: Site): ThermalResult {
  const cls = thermalClass(b.type);
  const d = gsop(site, b.tInside);
  const ab = AB[cls];
  const rWall = ab.wall[0] * d + ab.wall[1];
  const rRoof = ab.roof[0] * d + ab.roof[1];
  const wallOk = b.heated && env.walls === 'sandwich';
  const roofOk = b.heated && env.roofing === 'sandwich';
  const wall = part(env.wallCore, env.wallThk, rWall, 0.63, wallOk);
  const roof = part(env.roofCore, env.roofThk, rRoof, 0.8, roofOk);
  const notes: string[] = [];
  if (b.heated) {
    if (env.walls !== 'sandwich') notes.push('Отапливаемое здание без утеплённых стен: теплозащита не обеспечена.');
    if (env.roofing !== 'sandwich') notes.push('Отапливаемое здание с холодной кровлей: теплозащита не обеспечена.');
    if (wall.status === 'low') notes.push(`Стеновые панели ${env.wallThk} мм не проходят по теплозащите, нужно не менее ${wall.recommended} мм.`);
    if (roof.status === 'low') notes.push(`Кровельные панели ${env.roofThk} мм не проходят по теплозащите, нужно не менее ${roof.recommended} мм.`);
    if (wall.status === 'reduced' || roof.status === 'reduced') {
      notes.push('Толщина панелей меньше нормируемой поэлементно: допустимо только при выполнении комплексного требования по удельной теплозащитной характеристике (п. 5.2 СП 50.13330).');
    }
  }
  return { heated: b.heated, cls, gsop: d, wall, roof, notes };
}

/** Рекомендуемые толщины стен и кровли для отапливаемого здания */
export function recommendedPanels(type: BuildingType, tInside: number, site: Site, wallCore: CoreType, roofCore: CoreType) {
  const cls = thermalClass(type);
  const d = gsop(site, tInside);
  const ab = AB[cls];
  return {
    wall: recommendThickness(wallCore, ab.wall[0] * d + ab.wall[1]),
    roof: recommendThickness(roofCore, ab.roof[0] * d + ab.roof[1]),
  };
}
