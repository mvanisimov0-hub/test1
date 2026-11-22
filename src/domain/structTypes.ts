// Результаты расчёта каркаса.

import type { CheckItem } from './checks';
import type { GroupKey } from './frameModel';
import type { OpeningInstance } from './geometry';
import type { SectionFamily } from './sections';
import type { BaseFix, FrameTech, RoofScheme } from './types';

export type Vec3 = [number, number, number];

export type ElementRole =
  | 'column'
  | 'truss'
  | 'rafter'
  | 'purlin'
  | 'brace'
  | 'strut'
  | 'fakhverk'
  | 'girt'
  | 'crane'
  | 'floor'
  | 'opening';

/** Элемент каркаса в пространстве — для 3D, схем и ведомостей */
export interface Element3D {
  mark: string;
  role: ElementRole;
  sectionId: string;
  a: Vec3;
  b: Vec3;
}

export interface SpecPart {
  name: string;
  section: string;
  family: SectionFamily;
  length: number;
  mass: number;
}

export interface SpecRow {
  mark: string;
  name: string;
  /** сечение или состав (для ферм) */
  section: string;
  family: SectionFamily | 'mixed' | 'plate';
  /** длина одного элемента, м */
  length: number;
  count: number;
  massEach: number;
  massTotal: number;
  /** сборочная единица заводской сварки (ферма) */
  assembly: boolean;
  parts?: SpecPart[];
  note?: string;
}

export interface GroupResult {
  key: GroupKey;
  mark: string;
  label: string;
  section: string;
  sectionId: string;
  util: number;
  governing: string;
  combo: string;
  N: number;
  M: number;
  Q: number;
  lefIn: number;
  lefOut: number;
  lambdaX: number;
  lambdaY: number;
  items: CheckItem[];
}

export interface SecondaryResult {
  key: string;
  mark: string;
  label: string;
  section: string;
  sectionId: string;
  util: number;
  /** пояснение: пролёт, нагрузка, определяющая проверка */
  basis: string;
  count: number;
  length: number;
}

export interface LoadSummary {
  sg: number;
  mu: number;
  snowN: number;
  snow: number;
  /** снеговой мешок у перепада высот: перепад, μ у стены, длина зоны */
  snowDrift: { h: number; mu: number; b: number } | null;
  w0: number;
  k: number;
  zeta: number;
  nu: number;
  windN: number;
  wind: number;
  roofPanel: number;
  purlins: number;
  roofDeadN: number;
  roofDead: number;
  tech: number;
  wall: number;
  floorDeadN: number;
  floorLiveN: number;
  crane: { dMax: number; dMin: number; t: number } | null;
}

export interface FoundationLoad {
  cls: 'outer' | 'inner' | 'post';
  label: string;
  count: number;
  /** наибольшее сжатие, наибольший отрыв (отрицательное — отрыв), кН */
  nMax: number;
  nMin: number;
  /** наибольший момент и соответствующая продольная сила; поперечная сила */
  mMax: number;
  nAtM: number;
  qMax: number;
  comboN: string;
  comboM: string;
}

export interface ColumnPoint {
  x: number;
  z: number;
  cls: 'outer' | 'inner' | 'post' | 'fakhverk';
}

export interface SlsResult {
  deflection: number;
  deflectionLimit: number;
  drift: number;
  driftLimit: number;
  ok: boolean;
}

export interface StructureResult {
  ok: boolean;
  error: string | null;
  tech: FrameTech;
  techAuto: boolean;
  techReasons: string[];
  scheme: RoofScheme;
  baseFix: BaseFix;
  /** поперечная устойчивость обеспечена связями (малые здания), а не рамами */
  sideBraced: boolean;
  step: number;
  bays: number;
  frames: number[];
  /** привязки колонн и стоек фахверка в торцевых стенах, м */
  endStops: number[];
  spanLen: number;
  roofOffset: number;
  purlinH: number;
  loads: LoadSummary;
  cases: { id: string; name: string }[];
  comboCount: number;
  iterations: number;
  groups: GroupResult[];
  secondary: SecondaryResult[];
  sls: SlsResult;
  foundationLoads: FoundationLoad[];
  /** усилия от продольных связей на колонны связевых блоков, кН */
  braceReaction: { horizontal: number; vertical: number };
  /** сопряжение ферм с колоннами жёсткое */
  trussRigid: boolean;
  /** раскладка проёмов по стенам с учётом положения колонн */
  openings: OpeningInstance[];
  elements: Element3D[];
  spec: SpecRow[];
  columns: ColumnPoint[];
  mass: {
    total: number;
    tube: number;
    ibeam: number;
    channel: number;
    plate: number;
    /** масса ферм — сборочные единицы заводской сварки */
    truss: number;
    kgPerM2: number;
  };
  /** эпюры рядовой рамы для чертежа разреза */
  section2d: { members: { z1: number; y1: number; z2: number; y2: number; role: string; sectionId: string }[] };
  warnings: string[];
  assumptions: string[];
}
