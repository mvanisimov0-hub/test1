// Сортамент: профильная труба (ГОСТ 30245), двутавры (ГОСТ Р 57837 / СТО АСЧМ 20-93),
// швеллеры с параллельными гранями полок (ГОСТ 8240).
// Геометрические характеристики считаются из размеров сечения, а не набираются вручную:
// так в таблице не может быть опечатки в моменте инерции. Тесты сверяют массу с ГОСТ.

export type SectionFamily = 'tube' | 'ibeam' | 'channel';
/** тип кривой устойчивости по табл. 7 СП 16.13330 */
export type BucklingCurve = 'a' | 'b' | 'c';

export interface Section {
  id: string;
  name: string;
  family: SectionFamily;
  /** серия: sq, rect, Б, Ш, К, П */
  series: string;
  /** высота (в плоскости изгиба), ширина, толщина стенки и полки, мм */
  h: number;
  b: number;
  tw: number;
  tf: number;
  /** площадь, см² */
  A: number;
  /** моменты инерции, см⁴; моменты сопротивления, см³; радиусы инерции, см */
  Ix: number;
  Wx: number;
  ix: number;
  Iy: number;
  Wy: number;
  iy: number;
  /** момент инерции при свободном кручении, см⁴ */
  It: number;
  /** площадь стенки для проверки на срез, см² */
  Aw: number;
  /** масса погонного метра, кг/м */
  mass: number;
  curve: BucklingCurve;
}

const RHO = 7850; // кг/м³

function round(v: number, d = 2): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

/** Замкнутый гнутосварной профиль h×b×t, мм. Учитывает скругление углов (R = 2t снаружи). */
function tube(h: number, b: number, t: number): Section {
  const H = h / 10;
  const B = b / 10;
  const T = t / 10;
  const aSharp = 2 * T * (H + B - 2 * T);
  const ro = 2 * T;
  const ri = T;
  const A = aSharp - (4 - Math.PI) * (ro * ro - ri * ri);
  const k = (A / aSharp) * 0.99;
  const Ix = ((B * H ** 3 - (B - 2 * T) * (H - 2 * T) ** 3) / 12) * k;
  const Iy = ((H * B ** 3 - (H - 2 * T) * (B - 2 * T) ** 3) / 12) * k;
  // кручение замкнутого тонкостенного профиля (формула Бредта)
  const am = (H - T) * (B - T);
  const It = (4 * am * am * T) / (2 * (H - T) + 2 * (B - T));
  const sq = h === b;
  return {
    id: `T${h}x${b}x${t}`,
    name: sq ? `Труба ${h}×${t}` : `Труба ${h}×${b}×${t}`,
    family: 'tube',
    series: sq ? 'sq' : 'rect',
    h,
    b,
    tw: t,
    tf: t,
    A: round(A),
    Ix: round(Ix, 1),
    Wx: round(Ix / (H / 2), 1),
    ix: round(Math.sqrt(Ix / A)),
    Iy: round(Iy, 1),
    Wy: round(Iy / (B / 2), 1),
    iy: round(Math.sqrt(Iy / A)),
    It: round(It, 1),
    Aw: round(2 * (H - 2 * T) * T),
    mass: round((A / 1e4) * RHO),
    curve: 'a',
  };
}

/** Прокатный двутавр с параллельными гранями полок. */
function ibeam(name: string, series: string, h: number, b: number, tw: number, tf: number, r: number): Section {
  const H = h / 10;
  const B = b / 10;
  const S = tw / 10;
  const T = tf / 10;
  const R = r / 10;
  const hw = H - 2 * T;
  const fil = 1 - Math.PI / 4; // площадь одного скругления в долях r²
  const A = 2 * B * T + hw * S + 4 * fil * R * R;
  const yf = hw / 2 - 0.2234 * R; // плечо центра тяжести скругления
  const Ix = (B * H ** 3 - (B - S) * hw ** 3) / 12 + 4 * fil * R * R * yf * yf;
  const xf = S / 2 + 0.2234 * R;
  const Iy = (2 * T * B ** 3 + hw * S ** 3) / 12 + 4 * fil * R * R * xf * xf;
  const It = (1.29 * (2 * B * T ** 3 + hw * S ** 3)) / 3;
  return {
    id: `I${name}`,
    name: `Двутавр ${name}`,
    family: 'ibeam',
    series,
    h,
    b,
    tw,
    tf,
    A: round(A),
    Ix: round(Ix, 0),
    Wx: round(Ix / (H / 2), 1),
    ix: round(Math.sqrt(Ix / A)),
    Iy: round(Iy, 1),
    Wy: round(Iy / (B / 2), 1),
    iy: round(Math.sqrt(Iy / A)),
    It: round(It, 2),
    Aw: round(hw * S),
    mass: round((A / 1e4) * RHO, 1),
    curve: 'b',
  };
}

/** Швеллер с параллельными гранями полок. */
function channel(no: string, h: number, b: number, tw: number, tf: number): Section {
  const H = h / 10;
  const B = b / 10;
  const S = tw / 10;
  const T = tf / 10;
  const hw = H - 2 * T;
  const kFil = 1.012; // скругления
  const A = (H * S + 2 * (B - S) * T) * kFil;
  const Ix = ((B * H ** 3 - (B - S) * hw ** 3) / 12) * kFil;
  // центр тяжести от наружной грани стенки
  const a0 = H * S + 2 * (B - S) * T;
  const x0 = (H * S * (S / 2) + 2 * (B - S) * T * (S + (B - S) / 2)) / a0;
  const Iy =
    ((H * S ** 3) / 12 +
      H * S * (x0 - S / 2) ** 2 +
      2 * ((T * (B - S) ** 3) / 12 + T * (B - S) * (S + (B - S) / 2 - x0) ** 2)) *
    kFil;
  const It = (1.12 * (2 * B * T ** 3 + hw * S ** 3)) / 3;
  return {
    id: `C${no}`,
    name: `Швеллер ${no}П`,
    family: 'channel',
    series: 'П',
    h,
    b,
    tw,
    tf,
    A: round(A),
    Ix: round(Ix, 0),
    Wx: round(Ix / (H / 2), 1),
    ix: round(Math.sqrt(Ix / A)),
    Iy: round(Iy, 1),
    Wy: round(Iy / (B - x0), 1),
    iy: round(Math.sqrt(Iy / A)),
    It: round(It, 2),
    Aw: round(hw * S),
    mass: round((A / 1e4) * RHO, 1),
    curve: 'c',
  };
}

const SQ: [number, number][] = [
  [40, 3], [50, 3], [50, 4], [60, 3], [60, 4], [80, 3], [80, 4], [80, 5], [100, 3], [100, 4], [100, 5],
  [120, 4], [120, 5], [120, 6], [140, 4], [140, 5], [140, 6], [150, 5], [150, 6], [160, 5], [160, 6], [160, 8],
  [180, 5], [180, 6], [180, 8], [200, 5], [200, 6], [200, 8], [250, 6], [250, 8], [250, 10],
  [300, 8], [300, 10], [300, 12],
];

const RECT: [number, number, number][] = [
  [60, 40, 3], [80, 40, 3], [80, 60, 3], [80, 60, 4], [100, 50, 3], [100, 50, 4], [100, 60, 4], [120, 60, 4],
  [120, 80, 4], [120, 80, 5], [140, 60, 4], [140, 100, 4], [140, 100, 5], [160, 80, 4], [160, 80, 5],
  [160, 120, 5], [180, 100, 5], [180, 140, 6], [200, 100, 5], [200, 100, 6], [200, 120, 6], [200, 160, 6],
  [240, 120, 6], [250, 150, 6], [250, 150, 8], [300, 200, 8], [300, 200, 10],
];

export const SQUARE_TUBES: Section[] = SQ.map(([s, t]) => tube(s, s, t));
export const RECT_TUBES: Section[] = RECT.map(([h, b, t]) => tube(h, b, t));

export const IBEAMS: Section[] = [
  ibeam('20Б1', 'Б', 200, 100, 5.5, 8, 11),
  ibeam('25Б1', 'Б', 248, 124, 5, 8, 12),
  ibeam('25Б2', 'Б', 250, 125, 6, 9, 12),
  ibeam('30Б1', 'Б', 298, 149, 5.5, 8, 13),
  ibeam('30Б2', 'Б', 300, 150, 6.5, 9, 13),
  ibeam('35Б1', 'Б', 346, 174, 6, 9, 14),
  ibeam('35Б2', 'Б', 350, 175, 7, 11, 14),
  ibeam('40Б1', 'Б', 396, 199, 7, 11, 16),
  ibeam('40Б2', 'Б', 400, 200, 8, 13, 16),
  ibeam('45Б1', 'Б', 446, 199, 8, 12, 18),
  ibeam('45Б2', 'Б', 450, 200, 9, 14, 18),
  ibeam('50Б1', 'Б', 492, 199, 8.8, 12, 20),
  ibeam('50Б2', 'Б', 496, 199, 9, 14, 20),
  ibeam('55Б1', 'Б', 543, 220, 9.5, 13.5, 24),
  ibeam('60Б1', 'Б', 596, 199, 10, 15, 22),
  ibeam('60Б2', 'Б', 600, 200, 11, 17, 22),
  ibeam('70Б1', 'Б', 691, 260, 12, 15.5, 24),
  ibeam('20Ш1', 'Ш', 194, 150, 6, 9, 13),
  ibeam('25Ш1', 'Ш', 244, 175, 7, 11, 16),
  ibeam('30Ш1', 'Ш', 294, 200, 8, 12, 18),
  ibeam('35Ш1', 'Ш', 334, 249, 8, 11, 20),
  ibeam('35Ш2', 'Ш', 340, 250, 9, 14, 20),
  ibeam('40Ш1', 'Ш', 383, 299, 9.5, 12.5, 22),
  ibeam('40Ш2', 'Ш', 390, 300, 10, 16, 22),
  ibeam('50Ш1', 'Ш', 482, 300, 11, 15, 26),
  ibeam('20К1', 'К', 196, 199, 6.5, 10, 13),
  ibeam('20К2', 'К', 200, 200, 8, 12, 13),
  ibeam('25К1', 'К', 246, 249, 8, 12, 16),
  ibeam('25К2', 'К', 250, 250, 9, 14, 16),
  ibeam('30К1', 'К', 298, 299, 9, 14, 18),
  ibeam('30К2', 'К', 300, 300, 10, 15, 18),
  ibeam('35К1', 'К', 342, 348, 10, 15, 20),
  ibeam('40К1', 'К', 394, 398, 11, 18, 22),
];

export const CHANNELS: Section[] = [
  channel('10', 100, 46, 4.5, 7.6),
  channel('12', 120, 52, 4.8, 7.8),
  channel('14', 140, 58, 4.9, 8.1),
  channel('16', 160, 64, 5.0, 8.4),
  channel('18', 180, 70, 5.1, 8.7),
  channel('20', 200, 76, 5.2, 9.0),
  channel('22', 220, 82, 5.4, 9.5),
  channel('24', 240, 90, 5.6, 10),
  channel('27', 270, 95, 6, 10.5),
  channel('30', 300, 100, 6.5, 11),
];

export const ALL_SECTIONS: Section[] = [...SQUARE_TUBES, ...RECT_TUBES, ...IBEAMS, ...CHANNELS];

const BY_ID = new Map(ALL_SECTIONS.map((s) => [s.id, s]));

export function sectionById(id: string): Section {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`Нет сечения ${id} в сортаменте`);
  return s;
}

export function byMass(list: Section[]): Section[] {
  return [...list].sort((a, b) => a.mass - b.mass);
}

export const IBEAMS_B = IBEAMS.filter((s) => s.series === 'Б');
export const IBEAMS_COL = IBEAMS.filter((s) => s.series === 'Ш' || s.series === 'К');

/** Модуль упругости стали, кН/см² */
export const E_STEEL = 20600;

/** Расчётное сопротивление по пределу текучести, кН/см² */
export function steelRy(grade: 'C255' | 'C345'): number {
  return grade === 'C345' ? 32 : 24;
}
