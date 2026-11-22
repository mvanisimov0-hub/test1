// Шаблоны типов зданий: типовые габариты и решения, с которых менеджер начинает расчёт.

import { DEFAULT_SETTLEMENT, settlementById, type Settlement } from './climate';
import { SNOW_SG } from './loads';
import { recommendedPanels } from './thermal';
import {
  SCHEMA_VERSION,
  type Building,
  type BuildingType,
  type Envelope,
  type FoundationOptions,
  type FrameOptions,
  type Opening,
  type Project,
  type Site,
} from './types';

type OpeningSeed = Omit<Opening, 'id' | 'offset'> & { offset?: number | null };

export interface Preset {
  label: string;
  hint: string;
  building: Omit<Building, 'type'>;
  envelope: Partial<Envelope>;
  frame: Partial<FrameOptions>;
  foundation: FoundationOptions;
  openings: OpeningSeed[];
  electric: Project['electric'];
}

const B0 = { spans: 1, floors: 1, floorLength: null, floorLiveKpa: 2 } as const;

export const PRESETS: Record<BuildingType, Preset> = {
  hozblok: {
    label: 'Хозблок',
    hint: 'бытовка, кладовая, пост охраны',
    building: { ...B0, width: 3, length: 6, height: 2.4, roof: 'mono', slopeDeg: 7, heated: false, tInside: 5 },
    envelope: { wallThk: 50, roofThk: 50 },
    frame: {},
    foundation: { type: 'screw', floor: 'none', floorThk: 100, topping: false, blindArea: false },
    openings: [
      { kind: 'door', subtype: 'steel', wall: 'left', w: 0.9, h: 2.05, qty: 1, sill: 0 },
      { kind: 'window', subtype: 'pvc', wall: 'left', w: 1.0, h: 1.0, qty: 1, sill: 1.0 },
    ],
    electric: { enabled: true, level: 'basic' },
  },
  garage: {
    label: 'Гараж',
    hint: 'на 1–4 машины, тёплый или холодный',
    building: { ...B0, width: 6, length: 8, height: 3, roof: 'gable', slopeDeg: 12, heated: true, tInside: 10 },
    envelope: {},
    frame: {},
    foundation: { type: 'slab', floor: 'none', floorThk: 150, topping: false, blindArea: true },
    openings: [
      { kind: 'gate', subtype: 'sectional', wall: 'front', w: 3, h: 2.5, qty: 1, sill: 0, automation: true },
      { kind: 'door', subtype: 'steel', wall: 'left', w: 0.9, h: 2.05, qty: 1, sill: 0 },
      { kind: 'window', subtype: 'pvc', wall: 'right', w: 1.2, h: 0.8, qty: 2, sill: 1.4 },
    ],
    electric: { enabled: true, level: 'basic' },
  },
  hangar: {
    label: 'Ангар',
    hint: 'холодный склад, стоянка техники',
    building: { ...B0, width: 18, length: 36, height: 6, roof: 'gable', slopeDeg: 10, heated: false, tInside: 5 },
    envelope: { wallThk: 60, roofThk: 80 },
    frame: {},
    foundation: { type: 'pads', floor: 'concrete', floorThk: 150, topping: false, blindArea: true },
    openings: [
      { kind: 'gate', subtype: 'swing', wall: 'front', w: 4.5, h: 4.5, qty: 1, sill: 0 },
      { kind: 'gate', subtype: 'swing', wall: 'back', w: 4.5, h: 4.5, qty: 1, sill: 0 },
      { kind: 'door', subtype: 'steel', wall: 'left', w: 0.9, h: 2.05, qty: 1, sill: 0 },
    ],
    electric: { enabled: true, level: 'basic' },
  },
  warehouse: {
    label: 'Тёплый склад',
    hint: 'отапливаемый склад с воротами под фуры',
    building: { ...B0, width: 24, length: 48, height: 8, roof: 'gable', slopeDeg: 10, heated: true, tInside: 12 },
    envelope: {},
    frame: {},
    foundation: { type: 'pads', floor: 'concrete', floorThk: 200, topping: true, blindArea: true },
    openings: [
      { kind: 'gate', subtype: 'sectional', wall: 'left', w: 4, h: 4.5, qty: 2, sill: 0, automation: true },
      { kind: 'door', subtype: 'steel', wall: 'front', w: 0.9, h: 2.05, qty: 1, sill: 0 },
      { kind: 'door', subtype: 'steel', wall: 'back', w: 0.9, h: 2.05, qty: 1, sill: 0 },
    ],
    electric: { enabled: true, level: 'standard' },
  },
  shop: {
    label: 'Магазин',
    hint: 'торговый павильон, шоурум',
    building: { ...B0, floorLiveKpa: 4, width: 15, length: 30, height: 4.5, roof: 'gable', slopeDeg: 8, heated: true, tInside: 18 },
    envelope: { wallColor: '7024', trimColor: '9003' },
    frame: {},
    foundation: { type: 'pads', floor: 'concrete', floorThk: 150, topping: false, blindArea: true },
    openings: [
      { kind: 'window', subtype: 'vitrage', wall: 'left', w: 3, h: 2.6, qty: 5, sill: 0.3 },
      { kind: 'door', subtype: 'alu', wall: 'left', w: 1.6, h: 2.3, qty: 1, sill: 0 },
      { kind: 'gate', subtype: 'sectional', wall: 'back', w: 3, h: 3, qty: 1, sill: 0, automation: true },
      { kind: 'door', subtype: 'steel', wall: 'right', w: 0.9, h: 2.05, qty: 1, sill: 0 },
    ],
    electric: { enabled: true, level: 'standard' },
  },
  abk: {
    label: 'АБК',
    hint: 'административно-бытовой корпус, офис',
    building: { ...B0, floors: 2, width: 12, length: 24, height: 6.6, roof: 'gable', slopeDeg: 8, heated: true, tInside: 20 },
    envelope: {},
    frame: {},
    foundation: { type: 'pads', floor: 'concrete', floorThk: 120, topping: false, blindArea: true },
    openings: [
      { kind: 'window', subtype: 'pvc', wall: 'left', w: 1.5, h: 1.5, qty: 6, sill: 0.9 },
      { kind: 'window', subtype: 'pvc', wall: 'left', w: 1.5, h: 1.5, qty: 7, sill: 4.2 },
      { kind: 'window', subtype: 'pvc', wall: 'right', w: 1.5, h: 1.5, qty: 7, sill: 0.9 },
      { kind: 'window', subtype: 'pvc', wall: 'right', w: 1.5, h: 1.5, qty: 7, sill: 4.2 },
      { kind: 'door', subtype: 'steel', wall: 'left', w: 1.3, h: 2.1, qty: 1, sill: 0 },
      { kind: 'door', subtype: 'steel', wall: 'back', w: 0.9, h: 2.05, qty: 1, sill: 0 },
    ],
    electric: { enabled: true, level: 'standard' },
  },
  production: {
    label: 'Производство',
    hint: 'цех с кран-балкой',
    building: { ...B0, floorLiveKpa: 5, width: 24, length: 60, height: 9, roof: 'gable', slopeDeg: 10, heated: true, tInside: 16 },
    envelope: {},
    frame: { crane: { type: 'bridge', capacity: 5 } },
    foundation: { type: 'pads', floor: 'concrete', floorThk: 200, topping: true, blindArea: true },
    openings: [
      { kind: 'gate', subtype: 'sectional', wall: 'front', w: 4.5, h: 5, qty: 1, sill: 0, automation: true },
      { kind: 'gate', subtype: 'sectional', wall: 'back', w: 4.5, h: 5, qty: 1, sill: 0, automation: true },
      { kind: 'door', subtype: 'steel', wall: 'left', w: 0.9, h: 2.05, qty: 2, sill: 0 },
      { kind: 'window', subtype: 'pvc', wall: 'left', w: 3, h: 1.2, qty: 8, sill: 3 },
      { kind: 'window', subtype: 'pvc', wall: 'right', w: 3, h: 1.2, qty: 8, sill: 3 },
    ],
    electric: { enabled: true, level: 'power' },
  },
  autoservice: {
    label: 'Автосервис, мойка',
    hint: 'СТО, шиномонтаж, автомойка',
    building: { ...B0, width: 12, length: 24, height: 4.5, roof: 'gable', slopeDeg: 10, heated: true, tInside: 16 },
    envelope: {},
    frame: {},
    foundation: { type: 'slab', floor: 'none', floorThk: 200, topping: true, blindArea: true },
    openings: [
      { kind: 'gate', subtype: 'sectional', wall: 'left', w: 3.5, h: 3.5, qty: 4, sill: 0, automation: true },
      { kind: 'door', subtype: 'steel', wall: 'front', w: 0.9, h: 2.05, qty: 1, sill: 0 },
      { kind: 'window', subtype: 'pvc', wall: 'right', w: 1.5, h: 1.2, qty: 4, sill: 1.6 },
    ],
    electric: { enabled: true, level: 'standard' },
  },
  agro: {
    label: 'Сельхоз здание',
    hint: 'коровник, овощехранилище, зерносклад',
    building: { ...B0, width: 21, length: 72, height: 4.5, roof: 'gable', slopeDeg: 12, heated: false, tInside: 5 },
    envelope: { wallThk: 60, roofThk: 80 },
    frame: {},
    foundation: { type: 'pads', floor: 'none', floorThk: 150, topping: false, blindArea: false },
    openings: [
      { kind: 'gate', subtype: 'swing', wall: 'front', w: 4, h: 4, qty: 1, sill: 0 },
      { kind: 'gate', subtype: 'swing', wall: 'back', w: 4, h: 4, qty: 1, sill: 0 },
      { kind: 'door', subtype: 'steel', wall: 'left', w: 0.9, h: 2.05, qty: 2, sill: 0 },
    ],
    electric: { enabled: true, level: 'basic' },
  },
  canopy: {
    label: 'Навес',
    hint: 'каркас с кровлей без стен',
    building: { ...B0, width: 12, length: 24, height: 5, roof: 'gable', slopeDeg: 8, heated: false, tInside: 5 },
    envelope: { walls: 'none', roofing: 'proflist' },
    frame: {},
    foundation: { type: 'bored', floor: 'none', floorThk: 150, topping: false, blindArea: false },
    openings: [],
    electric: { enabled: false, level: 'basic' },
  },
};

export const BUILDING_TYPES = Object.keys(PRESETS) as BuildingType[];

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function siteFromSettlement(st: Settlement, prev?: Site): Site {
  return {
    settlementId: st.id,
    address: prev?.address ?? '',
    snowDistrict: st.snow,
    sg: st.sg ?? SNOW_SG[st.snow],
    windDistrict: st.wind,
    terrain: prev?.terrain ?? 'B',
    tHeat: st.tHeat,
    zHeat: st.zHeat,
    frostDepth: st.frost,
    soilR0: prev?.soilR0 ?? 200,
    deliveryKm: prev?.deliveryKm ?? 30,
  };
}

const ENVELOPE0: Envelope = {
  walls: 'sandwich',
  wallCore: 'mw',
  wallThk: 100,
  wallLayout: 'horizontal',
  roofing: 'sandwich',
  roofCore: 'mw',
  roofThk: 150,
  wallColor: '9003',
  roofColor: '7024',
  trimColor: '7024',
  gutters: true,
  snowGuards: true,
  partitionsArea: 0,
  partitionThk: 80,
};

const FRAME0: FrameOptions = {
  tech: 'auto',
  step: null,
  roofScheme: 'auto',
  base: 'auto',
  trussJoint: 'auto',
  columnProfile: 'auto',
  steel: 'C255',
  coating: 'primer',
  crane: { type: 'none', capacity: 5 },
};

export const DEFAULT_PAYMENT =
  '30% — аванс при подписании договора (проектирование и запуск в производство); 40% — перед отгрузкой металлоконструкций; 20% — перед поставкой панелей; 10% — после подписания акта выполненных работ.';

export function kpNumber(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear()).slice(2)}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

/** Применить шаблон типа здания: габариты, проёмы, фундамент; клиент и площадка сохраняются */
export function applyPreset(p: Project, type: BuildingType): Project {
  const pr = PRESETS[type];
  const building: Building = { ...pr.building, type };
  const envelope: Envelope = { ...ENVELOPE0, wallColor: p.envelope.wallColor, roofColor: p.envelope.roofColor, trimColor: p.envelope.trimColor, ...pr.envelope };
  if (building.heated && envelope.walls === 'sandwich') {
    const rec = recommendedPanels(type, building.tInside, p.site, envelope.wallCore, envelope.roofCore);
    envelope.wallThk = rec.wall;
    envelope.roofThk = rec.roof;
  }
  return {
    ...p,
    building,
    envelope,
    frame: { ...FRAME0, steel: p.frame.steel, coating: p.frame.coating, ...pr.frame },
    foundation: { ...pr.foundation },
    openings: pr.openings.map((o) => ({ offset: null, ...o, id: uid() })),
    electric: { ...pr.electric },
    stairs: null,
    overrides: {},
  };
}

export function newProject(type: BuildingType = 'hangar', entityId = ''): Project {
  const st = settlementById(DEFAULT_SETTLEMENT)!;
  const now = new Date().toISOString();
  const base: Project = {
    schema: SCHEMA_VERSION,
    id: uid(),
    number: kpNumber(),
    name: '',
    createdAt: now,
    updatedAt: now,
    client: { name: '', contact: '', phone: '', email: '' },
    manager: { name: '', phone: '', email: '' },
    building: { ...PRESETS[type].building, type },
    site: siteFromSettlement(st),
    frame: { ...FRAME0 },
    envelope: { ...ENVELOPE0 },
    openings: [],
    foundation: { ...PRESETS[type].foundation },
    electric: { enabled: true, level: 'basic' },
    stairs: null,
    commercial: {
      entityId,
      markupMat: 15,
      markupWork: 25,
      discount: 0,
      contingency: 0,
      validDays: 14,
      paymentTerms: DEFAULT_PAYMENT,
      notes: '',
    },
    overrides: {},
    customLines: [],
  };
  return applyPreset(base, type);
}
