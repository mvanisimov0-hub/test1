// Модель данных расчёта. Всё, что хранится в файле расчёта, описано здесь.
// Расчётное ядро (src/domain) не зависит от интерфейса и браузера:
// его можно без изменений перенести на сервер.

export const SCHEMA_VERSION = 1;

export type BuildingType =
  | 'hozblok'
  | 'garage'
  | 'hangar'
  | 'warehouse'
  | 'shop'
  | 'abk'
  | 'production'
  | 'autoservice'
  | 'agro'
  | 'canopy';

export type RoofShape = 'gable' | 'mono';
export type FrameTech = 'welded' | 'kmd';
export type FrameTechChoice = 'auto' | FrameTech;
export type RoofScheme = 'beam' | 'truss';
export type RoofSchemeChoice = 'auto' | RoofScheme;
export type BaseFix = 'fixed' | 'pinned';
export type BaseFixChoice = 'auto' | BaseFix;
export type CoreType = 'mw' | 'pir' | 'eps';
export type WallCladding = 'sandwich' | 'proflist' | 'none';
export type RoofCladding = 'sandwich' | 'proflist';
export type WallSide = 'front' | 'back' | 'left' | 'right';
export type Terrain = 'A' | 'B' | 'C';
export type FoundationType = 'screw' | 'pads' | 'bored' | 'slab' | 'customer';
export type CraneType = 'none' | 'suspended' | 'bridge';
export type SteelGrade = 'C255' | 'C345';
export type Coating = 'primer' | 'enamel' | 'zinc';
export type VatMode = 'none' | 'included';
export type ColumnProfileChoice = 'auto' | 'tube' | 'ibeam';

export type OpeningKind = 'gate' | 'door' | 'window';

export interface Opening {
  id: string;
  kind: OpeningKind;
  /** gate: sectional | swing | roller; door: steel | alu | fire; window: pvc | vitrage */
  subtype: string;
  wall: WallSide;
  /** ширина и высота проёма, м */
  w: number;
  h: number;
  qty: number;
  /** отметка низа проёма от пола, м */
  sill: number;
  /** привязка первого проёма от начала стены, м; null — равномерно по стене */
  offset: number | null;
  automation?: boolean;
}

export interface Building {
  type: BuildingType;
  /** ширина по осям (поперёк рам), м */
  width: number;
  /** длина по осям, м */
  length: number;
  /** высота до низа несущих конструкций покрытия, м */
  height: number;
  /** число пролётов поперёк здания */
  spans: number;
  roof: RoofShape;
  slopeDeg: number;
  /** число этажей (уровней) */
  floors: number;
  /** длина зоны с перекрытиями от оси 1, м; null — на всю длину. Антресоль = часть длины. */
  floorLength: number | null;
  /** полезная нагрузка на перекрытие, кПа */
  floorLiveKpa: number;
  heated: boolean;
  /** расчётная температура внутри, °C */
  tInside: number;
}

export interface Site {
  settlementId: string;
  address: string;
  snowDistrict: number;
  /** нормативный вес снегового покрова Sg, кПа */
  sg: number;
  windDistrict: string;
  terrain: Terrain;
  /** средняя температура и длительность отопительного периода */
  tHeat: number;
  zHeat: number;
  /** нормативная глубина промерзания, м */
  frostDepth: number;
  /** расчётное сопротивление грунта основания R0, кПа */
  soilR0: number;
  deliveryKm: number;
}

export interface FrameOptions {
  tech: FrameTechChoice;
  /** шаг рам, м; null — подобрать автоматически */
  step: number | null;
  roofScheme: RoofSchemeChoice;
  base: BaseFixChoice;
  columnProfile: ColumnProfileChoice;
  steel: SteelGrade;
  coating: Coating;
  crane: { type: CraneType; capacity: number };
}

export interface Envelope {
  walls: WallCladding;
  wallCore: CoreType;
  /** толщина стеновой панели, мм */
  wallThk: number;
  wallLayout: 'horizontal' | 'vertical';
  roofing: RoofCladding;
  roofCore: CoreType;
  roofThk: number;
  wallColor: string;
  roofColor: string;
  trimColor: string;
  gutters: boolean;
  snowGuards: boolean;
  /** площадь внутренних перегородок из сэндвич-панелей, м² */
  partitionsArea: number;
  partitionThk: number;
}

export interface FoundationOptions {
  type: FoundationType;
  floor: 'none' | 'concrete';
  /** толщина бетонного пола, мм */
  floorThk: number;
  topping: boolean;
  blindArea: boolean;
}

export interface ElectricOptions {
  enabled: boolean;
  /** basic — освещение и розетки; power — с силовым оборудованием */
  level: 'basic' | 'standard' | 'power';
}

export interface Commercial {
  entityId: string;
  /** наценка на материалы и на работы, % */
  markupMat: number;
  markupWork: number;
  discount: number;
  /** резерв на непредвиденные, % */
  contingency: number;
  validDays: number;
  paymentTerms: string;
  notes: string;
}

export interface LineOverride {
  qty?: number;
  mat?: number;
  work?: number;
}

export interface CustomLine {
  id: string;
  section: string;
  name: string;
  unit: string;
  qty: number;
  mat: number;
  work: number;
}

export interface Project {
  schema: number;
  id: string;
  /** номер КП */
  number: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  client: { name: string; contact: string; phone: string; email: string };
  manager: { name: string; phone: string; email: string };
  building: Building;
  site: Site;
  frame: FrameOptions;
  envelope: Envelope;
  openings: Opening[];
  foundation: FoundationOptions;
  electric: ElectricOptions;
  /** число металлических лестниц; null — по расчёту */
  stairs: number | null;
  commercial: Commercial;
  overrides: Record<string, LineOverride>;
  customLines: CustomLine[];
}

export interface LegalEntity {
  id: string;
  name: string;
  inn: string;
  kpp: string;
  address: string;
  phone: string;
  email: string;
  bank: string;
  vatMode: VatMode;
  vatRate: number;
}

export interface PriceItem {
  id: string;
  group: string;
  name: string;
  unit: string;
  /** себестоимость материала и работы за единицу, ₽ */
  mat: number;
  work: number;
}

export interface Settings {
  entities: LegalEntity[];
  prices: PriceItem[];
  /** логотип для КП, data URL */
  logo: string;
  brand: string;
  slogan: string;
  site: string;
}
