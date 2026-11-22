import { describe, expect, it } from 'vitest';
import { calcProject } from '../src/domain/calc';
import { FemModel } from '../src/domain/fem';
import { buildCases, buildCombos, buildPlaneFrame } from '../src/domain/frameModel';
import { BUILDING_TYPES, newProject } from '../src/domain/presets';
import { defaultSettings } from '../src/domain/settings';
import { calcStructure, resolveTech } from '../src/domain/structure';

const settings = defaultSettings();

describe('каркас: все шаблоны зданий', () => {
  it.each(BUILDING_TYPES)('%s рассчитывается, сечения проходят проверки', (type) => {
    const p = newProject(type, 'osn');
    const r = calcStructure(p);
    expect(r.ok).toBe(true);
    for (const g of r.groups) expect(g.util, `${g.label}: ${g.governing}`).toBeLessThanOrEqual(1.0001);
    for (const s of r.secondary) expect(s.util, s.label).toBeLessThanOrEqual(1.0001);
    expect(r.sls.ok).toBe(true);
    // расход стали в реалистичных пределах для лёгких каркасов
    expect(r.mass.kgPerM2).toBeGreaterThan(15);
    expect(r.mass.kgPerM2).toBeLessThan(type === 'abk' ? 90 : 60);
    // масса из ведомости сходится с итогом
    const fromSpec = r.spec.reduce((s, row) => s + row.massTotal, 0);
    expect(fromSpec).toBeCloseTo(r.mass.total, 3);
  });
});

describe('каркас: зависимости от исходных данных', () => {
  it('тяжёлый снег не уменьшает массу каркаса', () => {
    const a = newProject('hangar', 'osn');
    const b = newProject('hangar', 'osn');
    a.site.sg = 1.0;
    b.site.sg = 2.5;
    expect(calcStructure(b).mass.total).toBeGreaterThan(calcStructure(a).mass.total);
  });

  it('правило выбора технологии: сварной каркас до 12 м пролёта', () => {
    const p = newProject('hangar', 'osn');
    p.building.width = 12;
    expect(resolveTech(p).tech).toBe('welded');
    p.building.width = 12.5;
    expect(resolveTech(p).tech).toBe('kmd');
    p.building.width = 10;
    p.frame.crane = { type: 'bridge', capacity: 5 };
    expect(resolveTech(p).tech).toBe('kmd');
  });

  it('многопролётное здание получает средние колонны', () => {
    const p = newProject('warehouse', 'osn');
    p.building.width = 48;
    p.building.spans = 2;
    const r = calcStructure(p);
    expect(r.ok).toBe(true);
    expect(r.groups.some((g) => g.key === 'colInner')).toBe(true);
    expect(r.columns.filter((c) => c.cls === 'inner').length).toBe(r.frames.length);
  });

  it('антресоль на части длины даёт два типа рам и балки перекрытия', () => {
    const p = newProject('warehouse', 'osn');
    p.building.floors = 2;
    p.building.floorLength = 12;
    const r = calcStructure(p);
    expect(r.ok).toBe(true);
    expect(r.groups.some((g) => g.key === 'floorBeam')).toBe(true);
    expect(r.spec.some((row) => row.mark === 'БП2')).toBe(true);
  });

  it('проёмы на продольных стенах не попадают на колонны', () => {
    for (const type of BUILDING_TYPES) {
      const p = newProject(type, 'osn');
      const r = calcStructure(p);
      for (const o of r.openings) {
        if (o.wall !== 'left' && o.wall !== 'right') continue;
        if (o.opening.kind === 'window' && o.sill >= 2.5) continue;
        const hit = r.frames.some((x) => x > o.u + 0.05 && x < o.u + o.w - 0.05);
        expect(hit, `${type}: проём ${o.opening.kind} на колонне`).toBe(false);
      }
    }
  });
});

describe('статика рамы: равновесие', () => {
  it('сумма вертикальных реакций равна сумме вертикальных нагрузок в каждом загружении', () => {
    const p = newProject('hangar', 'osn');
    const b = p.building;
    const f = buildPlaneFrame(b, { scheme: 'truss', baseFix: 'fixed', withFloors: false, craneType: 'none', craneCapacity: 0, maxPurlin: 3, sideBraced: false, trussRigid: false });
    const { cases } = buildCases(b, f, {
      step: 6, roofDead: 0.4, roofDeadN: 0.33, tech: 0.12, techN: 0.1, snow: 2.1, wind: 0.45, wall: 0.25, wallN: 0.2,
      canopy: false, floorDead: 0, floorDeadN: 0, floorLive: 0, floorLiveGamma: 1.2, crane: null, massOf: () => 15,
    });
    const model = new FemModel(f.nodes, f.members.map((m) => ({ n1: m.n1, n2: m.n2, rel1: m.rel1, rel2: m.rel2, EA: 5e5, EI: 5e3 })));
    for (const c of cases) {
      const r = model.solve(c.lc);
      let fy = 0;
      let fx = 0;
      for (const n of c.lc.nodal) {
        fy += n.fy;
        fx += n.fx;
      }
      for (const d of c.lc.dist) {
        fy += d.qy * f.members[d.elem].len;
        fx += d.qx * f.members[d.elem].len;
      }
      let ry = 0;
      let rx = 0;
      f.nodes.forEach((_, i) => {
        rx += r.reactions[i * 3];
        ry += r.reactions[i * 3 + 1];
      });
      expect(ry, c.name).toBeCloseTo(-fy, 5);
      expect(rx, c.name).toBeCloseTo(-fx, 5);
    }
    expect(buildCombos(cases).length).toBeGreaterThan(5);
  });
});

describe('смета', () => {
  it('итог равен сумме разделов с наценкой, скидка и ручные правки работают', () => {
    const p = newProject('hangar', 'osn');
    const r = calcProject(p, settings);
    const sum = r.estimate.sections.reduce((s, x) => s + x.price, 0);
    expect(r.estimate.totals.total).toBe(Math.round(sum));
    expect(r.estimate.totals.margin).toBeGreaterThan(0);
    // НДС 22% выделяется из суммы
    expect(r.estimate.totals.vat).toBeCloseTo((r.estimate.totals.total * 22) / 122, 2);

    const p2 = structuredClone(p);
    p2.commercial.discount = 5;
    const r2 = calcProject(p2, settings);
    expect(r2.estimate.totals.total).toBe(Math.round(sum * 0.95));

    const line = r.estimate.sections.find((s) => s.id === 'envelope')!.lines[0];
    const p3 = structuredClone(p);
    p3.overrides[line.id] = { qty: line.qty + 100 };
    const r3 = calcProject(p3, settings);
    // прямая стоимость строки плюс доля организации площадки от стоимости работ
    const delta = r3.estimate.totals.cost - r.estimate.totals.cost;
    expect(delta).toBeGreaterThanOrEqual(100 * (line.mat + line.work));
    expect(delta).toBeLessThan(100 * (line.mat + line.work) * 1.03);
    expect(r3.estimate.sections.find((s) => s.id === 'envelope')!.lines[0].overridden).toBe(true);

    const p4 = structuredClone(p);
    p4.commercial.entityId = 'usn';
    expect(calcProject(p4, settings).estimate.totals.vat).toBe(0);
  });

  it('фундамент заказчика исключает бетонные работы', () => {
    const p = newProject('hangar', 'osn');
    p.foundation.type = 'customer';
    const r = calcProject(p, settings);
    expect(r.foundation.concrete).toBe(0);
    expect(r.structure.foundationLoads.length).toBeGreaterThan(0);
  });
});
