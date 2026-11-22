import { describe, expect, it } from 'vitest';
import { annexPlacement, toWorld } from '../src/domain/blocks';
import { calcProject } from '../src/domain/calc';
import { layoutOpenings } from '../src/domain/geometry';
import { BUILDING_TYPES, newAnnex, newProject } from '../src/domain/presets';
import { defaultSettings } from '../src/domain/settings';
import type { WallSide } from '../src/domain/types';

const settings = defaultSettings();

describe('пристройки: положение на плане', () => {
  it.each(['left', 'right', 'front', 'back'] as WallSide[])('у стены %s блок лежит снаружи основного здания и в пределах привязки', (wall) => {
    const p = newProject('hangar', 'osn'); // 18×36
    for (const mode of ['side', 'end'] as const) {
      const a = { ...newAnnex(p, 1), wall, mode, offset: 3 };
      const pl = annexPlacement(p.building, a);
      // оси блока — правая тройка: ex × Y = ez
      expect(-pl.ex[1]).toBeCloseTo(pl.ez[0], 9);
      expect(pl.ex[0]).toBeCloseTo(pl.ez[1], 9);
      const pts = [toWorld(pl, 0, 0), toWorld(pl, a.building.length, a.building.width)];
      const xs = pts.map((q) => q[0]);
      const zs = pts.map((q) => q[1]);
      const ext = mode === 'side' ? a.building.length : a.building.width;
      if (wall === 'left') expect(Math.max(...zs)).toBeLessThan(0);
      if (wall === 'right') expect(Math.min(...zs)).toBeGreaterThan(p.building.width);
      if (wall === 'front') expect(Math.max(...xs)).toBeLessThan(0);
      if (wall === 'back') expect(Math.min(...xs)).toBeGreaterThan(p.building.length);
      const along = wall === 'left' || wall === 'right' ? xs : zs;
      expect(Math.min(...along)).toBeCloseTo(3, 9);
      expect(Math.max(...along)).toBeCloseTo(3 + ext, 9);
    }
  });
});

describe('составное здание', () => {
  it('пристройка добавляет металл, площадь и строки сметы; у перепада высот учтён снеговой мешок', () => {
    const p = newProject('production', 'osn');
    const base = calcProject(p, settings);
    p.annexes.push(newAnnex(p, 1));
    const r = calcProject(p, settings);
    expect(r.blocks.length).toBe(2);
    const annex = r.blocks[1];
    expect(annex.structure.ok).toBe(true);
    expect(annex.structure.loads.snowDrift).not.toBeNull();
    expect(annex.structure.loads.snowDrift!.mu).toBeGreaterThan(1);
    expect(r.totals.mass).toBeCloseTo(base.totals.mass + annex.structure.mass.total, 3);
    expect(r.totals.floorArea).toBeCloseTo(base.totals.floorArea + 6 * 12, 6);
    expect(r.estimate.totals.total).toBeGreaterThan(base.estimate.totals.total);
    // стена примыкания не обшивается, вместо неё — планка примыкания кровли
    expect(annex.panels.pieces.some((q) => q.surface === 'left')).toBe(false);
    expect(annex.panels.trims.some((t) => t.priceId === 'trim.abut')).toBe(true);
    for (const g of annex.structure.groups) expect(g.util).toBeLessThanOrEqual(1.0001);
  });

  it('снеговой мешок утяжеляет пристройку по сравнению с отдельно стоящим зданием тех же размеров', () => {
    const p = newProject('production', 'osn');
    p.annexes.push({ ...newAnnex(p, 1), building: { ...newAnnex(p, 1).building, width: 9, length: 24 } });
    const attached = calcProject(p, settings).blocks[1];
    const alone = structuredClone(attached.project);
    alone.building.snowDrift = undefined;
    const free = calcProject(alone, settings).blocks[0];
    expect(attached.structure.mass.total).toBeGreaterThan(free.structure.mass.total);
  });
});

describe('раскладка панелей и фасонные элементы', () => {
  it.each(BUILDING_TYPES)('%s: заказная площадь не меньше чистой, панели не длиннее 12 м', (type) => {
    const p = newProject(type, 'osn');
    const r = calcProject(p, settings);
    const pn = r.panels;
    if (p.envelope.walls !== 'none') {
      expect(pn.wallArea).toBeGreaterThanOrEqual(r.geo.wallNet * 0.97);
      expect(pn.wallArea).toBeLessThan(r.geo.wallGross * 1.25);
      expect(pn.trims.some((t) => t.priceId === 'trim.plinth')).toBe(true);
    } else {
      expect(pn.wallCount).toBe(0);
    }
    expect(pn.roofArea).toBeGreaterThanOrEqual(r.geo.roofArea * 0.97);
    expect(pn.roofArea).toBeLessThan(r.geo.roofArea * 1.15);
    for (const g of pn.groups) expect(g.length).toBeLessThanOrEqual(12.5);
    // смета берёт панели из раскладки
    const env = r.estimate.sections.find((s) => s.id === 'envelope')!;
    const roofLine = env.lines.find((l) => l.id === 'roof.panel' || l.id === 'roof.proflist')!;
    expect(roofLine.qty).toBeCloseTo(pn.roofArea, 0);
  });

  it('панели не закрывают ворота', () => {
    const p = newProject('hangar', 'osn');
    const r = calcProject(p, settings);
    const gate = r.structure.openings.find((o) => o.opening.kind === 'gate' && o.wall === 'front')!;
    const inside = r.panels.pieces.filter(
      (q) => q.surface === 'front' && q.u >= gate.u - 0.01 && q.u + q.du <= gate.u + gate.w + 0.01 && q.v + q.dv <= gate.h + 0.01,
    );
    expect(inside.length).toBe(0);
  });

  it('расстановка мышью: заданные положения проёмов используются как есть', () => {
    const p = newProject('abk', 'osn');
    const o = p.openings.find((x) => x.kind === 'window' && x.wall === 'left')!;
    o.positions = Array.from({ length: o.qty }, (_, i) => 1 + i * 2.5);
    const items = layoutOpenings(p.building, p.openings).items.filter((it) => it.opening.id === o.id);
    expect(items.map((it) => it.u)).toEqual(o.positions);
  });
});
