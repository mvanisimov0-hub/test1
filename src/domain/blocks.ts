// Составное здание: основной блок и пристройки.
// Каждая пристройка считается как самостоятельный прямоугольный блок со своей системой осей,
// которая привязывается к стене основного здания поворотом на угол, кратный 90°.

import type { EnvelopeGeometry } from './geometry';
import type { Annex, Building, Project, SnowDrift, WallSide } from './types';

/** Положение блока на общем плане: world = origin + ex·x + ez·z (компоненты [X, Z]) */
export interface Placement {
  origin: [number, number];
  ex: [number, number];
  ez: [number, number];
}

export const MAIN_PLACEMENT: Placement = { origin: [0, 0], ex: [1, 0], ez: [0, 1] };

/** Зазор между осями колонн блоков: место для стеновых панелей основного здания */
export const BLOCK_GAP = 0.4;

const WALL: Record<WallSide, { u: [number, number]; n: [number, number]; at: (b: Building) => [number, number] }> = {
  left: { u: [1, 0], n: [0, -1], at: () => [0, 0] },
  right: { u: [1, 0], n: [0, 1], at: (b) => [0, b.width] },
  front: { u: [0, 1], n: [-1, 0], at: () => [0, 0] },
  back: { u: [0, 1], n: [1, 0], at: (b) => [b.length, 0] },
};

export function mainWallLength(main: Building, wall: WallSide): number {
  return wall === 'left' || wall === 'right' ? main.length : main.width;
}

/** Длина участка стены основного здания, занятого пристройкой */
export function annexExtent(a: Annex): number {
  return a.mode === 'side' ? a.building.length : a.building.width;
}

/** Сторона пристройки, обращённая к основному зданию */
export function annexSharedSide(a: Annex): WallSide {
  return a.mode === 'side' ? 'left' : 'front';
}

export function annexPlacement(main: Building, a: Annex): Placement {
  const w = WALL[a.wall];
  const p0 = w.at(main);
  const [nx, nz] = w.n;
  // правая тройка осей: ex × Y = ez
  const ex: [number, number] = a.mode === 'side' ? [nz, -nx] : [nx, nz];
  const ez: [number, number] = a.mode === 'side' ? [nx, nz] : [-nz, nx];
  const along = a.mode === 'side' ? ex : ez;
  const flipped = along[0] * w.u[0] + along[1] * w.u[1] < 0;
  const start = a.offset + (flipped ? annexExtent(a) : 0);
  return {
    origin: [p0[0] + w.u[0] * start + nx * BLOCK_GAP, p0[1] + w.u[1] * start + nz * BLOCK_GAP],
    ex,
    ez,
  };
}

export function toWorld(pl: Placement, x: number, z: number): [number, number] {
  return [pl.origin[0] + pl.ex[0] * x + pl.ez[0] * z, pl.origin[1] + pl.ex[1] * x + pl.ez[1] * z];
}

/** Габариты блока на общем плане: [minX, minZ, maxX, maxZ] */
export function blockBounds(pl: Placement, b: Building): [number, number, number, number] {
  const pts = [toWorld(pl, 0, 0), toWorld(pl, b.length, 0), toWorld(pl, 0, b.width), toWorld(pl, b.length, b.width)];
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

/**
 * Снеговой мешок на покрытии пристройки у стены более высокого основного здания (схема Б.8 СП 20):
 * μ = 1 + (m1·l1 + m2·l2) / h, не более 2h/Sg и не более 4; длина зоны b = 2h, не более 16 м.
 */
export function snowDriftFor(p: Project, a: Annex, mainGeo: EnvelopeGeometry): SnowDrift | undefined {
  const main = p.building;
  const ab = a.building;
  const tanA = Math.tan((ab.slopeDeg * Math.PI) / 180);
  const mainRise = main.roof === 'mono' && a.wall === 'left' ? main.width * Math.tan((main.slopeDeg * Math.PI) / 180) : 0;
  const mainTop = mainGeo.eaveHeight + mainRise;
  const rise = ab.roof === 'mono' ? ab.width * tanA : (ab.width / 2) * tanA;
  const annexTop = ab.height + 0.4 + (a.mode === 'side' ? (ab.roof === 'mono' ? rise : 0) : rise / 2);
  const h = mainTop - annexTop;
  if (h < 0.5) return undefined;
  const l1 = Math.min(48, a.wall === 'left' || a.wall === 'right' ? (main.roof === 'gable' ? main.width / 2 : main.width) : main.length);
  const l2 = a.mode === 'side' ? ab.width : ab.length;
  const m1 = main.slopeDeg <= 20 ? 0.4 : 0.3;
  let mu = 1 + (m1 * l1 + 0.5 * l2) / h;
  mu = Math.max(1, Math.min(mu, 4, (2 * h) / Math.max(0.3, p.site.sg)));
  if (mu <= 1.05) return undefined;
  return { h, mu, b: Math.min(16, Math.max(2 * h, 1)), dir: a.mode === 'side' ? 'z' : 'x' };
}

/** Пристройка как самостоятельный расчёт: наследует площадку, каркасные и отделочные решения основного здания */
export function annexProject(p: Project, a: Annex, mainGeo: EnvelopeGeometry): Project {
  const walls = !a.walls ? 'none' : p.envelope.walls === 'none' ? 'sandwich' : p.envelope.walls;
  return {
    ...p,
    building: { ...a.building, openSides: [annexSharedSide(a)], snowDrift: snowDriftFor(p, a, mainGeo) },
    openings: a.openings,
    envelope: { ...p.envelope, walls, partitionsArea: 0 },
    frame: { ...p.frame, step: null, roofScheme: 'auto', crane: { type: 'none', capacity: 0 } },
    stairs: null,
    annexes: [],
    overrides: {},
    customLines: [],
  };
}

/** Проверки взаимного положения блоков */
export function annexWarnings(p: Project, a: Annex): string[] {
  const out: string[] = [];
  const len = mainWallLength(p.building, a.wall);
  const ext = annexExtent(a);
  if (a.offset < -1e-6 || a.offset + ext > len + 1e-6) {
    out.push(`выходит за пределы стены основного здания (стена ${len.toFixed(1).replace('.', ',')} м, пристройка занимает ${ext.toFixed(1).replace('.', ',')} м с привязкой ${a.offset.toFixed(1).replace('.', ',')} м)`);
  }
  for (const o of p.annexes) {
    if (o.id === a.id || o.wall !== a.wall) continue;
    if (a.offset < o.offset + annexExtent(o) - 1e-6 && o.offset < a.offset + ext - 1e-6 && a.id > o.id) out.push(`пересекается с блоком «${o.name}» на той же стене`);
  }
  return out;
}
