// Точка входа расчётного ядра: проект + справочники → все результаты.

import { MAIN_PLACEMENT, annexPlacement, annexProject, annexWarnings, blockBounds, type Placement } from './blocks';
import { buildEstimate, type Estimate } from './estimate';
import { calcFoundation, type FoundationResult } from './foundation';
import { envelopeGeometry, type EnvelopeGeometry } from './geometry';
import { calcPanels, type PanelsResult } from './panels';
import { buildSchedule, type Schedule } from './schedule';
import { calcStructure } from './structure';
import type { StructureResult } from './structTypes';
import { calcThermal, type ThermalResult } from './thermal';
import type { FrameTech, LegalEntity, Project, Settings } from './types';

/** Результаты расчёта одного блока: основного здания или пристройки */
export interface BlockCalc {
  /** пустая строка — основное здание */
  id: string;
  label: string;
  /** расчёт блока как самостоятельного здания */
  project: Project;
  structure: StructureResult;
  geo: EnvelopeGeometry;
  thermal: ThermalResult;
  foundation: FoundationResult;
  panels: PanelsResult;
  placement: Placement;
  warnings: string[];
}

export interface Totals {
  mass: number;
  kgPerM2: number;
  floorArea: number;
  totalFloorArea: number;
  wallNet: number;
  roofArea: number;
  /** габариты всего здания на плане: [minX, minZ, maxX, maxZ] и наибольшая высота */
  bounds: [number, number, number, number];
  height: number;
}

export interface CalcResult {
  /** результаты основного здания (то же, что blocks[0]) */
  structure: StructureResult;
  geo: EnvelopeGeometry;
  thermal: ThermalResult;
  foundation: FoundationResult;
  panels: PanelsResult;
  blocks: BlockCalc[];
  totals: Totals;
  estimate: Estimate;
  schedule: Schedule;
  entity: LegalEntity | undefined;
  /** все замечания расчёта, требующие внимания менеджера */
  warnings: string[];
}

function calcBlock(id: string, label: string, p: Project, placement: Placement, forceTech?: FrameTech): BlockCalc {
  const structure = calcStructure(p, forceTech);
  const geo = envelopeGeometry(p.building, p.envelope, p.openings, structure.roofOffset, structure.purlinH);
  const thermal = calcThermal(p.building, p.envelope, p.site);
  const foundation = calcFoundation(p, structure, geo);
  const panels = calcPanels(p, structure, geo);
  const warnings = [...structure.warnings, ...thermal.notes, ...foundation.warnings];
  const open = new Set(p.building.openSides ?? []);
  for (const o of p.openings) {
    if (p.envelope.walls !== 'none' && !open.has(o.wall) && o.sill + o.h > geo.eaveHeight + 0.01 && (o.wall === 'left' || o.wall === 'right')) {
      warnings.push(`Проём ${o.w}×${o.h} м выше стены (${geo.eaveHeight.toFixed(1).replace('.', ',')} м): уменьшите высоту проёма или увеличьте высоту здания.`);
    }
  }
  return { id, label, project: p, structure, geo, thermal, foundation, panels, placement, warnings };
}

export function calcProject(p: Project, settings: Settings, forceTech?: FrameTech): CalcResult {
  const main = calcBlock('', 'Основное здание', p, MAIN_PLACEMENT, forceTech);
  const blocks: BlockCalc[] = [main];
  const warnings = [...main.warnings];
  for (const a of p.annexes ?? []) {
    const blk = calcBlock(a.id, a.name || 'Пристройка', annexProject(p, a, main.geo), annexPlacement(p.building, a));
    blocks.push(blk);
    for (const w of annexWarnings(p, a)) warnings.push(`${blk.label}: ${w}.`);
    for (const w of blk.warnings) warnings.push(`${blk.label}: ${w}`);
  }

  const sum = (f: (b: BlockCalc) => number) => blocks.reduce((a, b) => a + f(b), 0);
  const floorArea = sum((b) => b.geo.floorArea);
  const mass = sum((b) => b.structure.mass.total);
  const bb = blocks.map((b) => blockBounds(b.placement, b.project.building));
  const totals: Totals = {
    mass,
    kgPerM2: floorArea > 0 ? mass / floorArea : 0,
    floorArea,
    totalFloorArea: sum((b) => b.geo.totalFloorArea),
    wallNet: sum((b) => b.geo.wallNet),
    roofArea: sum((b) => b.geo.roofArea),
    bounds: [Math.min(...bb.map((x) => x[0])), Math.min(...bb.map((x) => x[1])), Math.max(...bb.map((x) => x[2])), Math.max(...bb.map((x) => x[3]))],
    height: Math.max(...blocks.map((b) => b.geo.ridgeHeight)),
  };

  const entity = settings.entities.find((e) => e.id === p.commercial.entityId) ?? settings.entities[0];
  const estimate = buildEstimate(p, blocks, settings.prices, entity);
  const schedule = buildSchedule({
    massT: mass / 1000,
    welded: main.structure.tech === 'welded',
    floorArea,
    totalFloorArea: totals.totalFloorArea,
    panelArea: totals.wallNet + totals.roofArea,
    floorSlabArea: sum((b) => b.geo.floorSlabArea),
    foundation: main.foundation.type,
    piles: sum((b) => b.foundation.piles),
    concrete: sum((b) => b.foundation.concrete),
    openCount: sum((b) => (b.project.envelope.walls === 'none' ? 0 : b.project.openings.reduce((s, o) => s + o.qty, 0))),
    walls: blocks.some((b) => b.project.envelope.walls !== 'none'),
    concreteFloor: p.foundation.floor === 'concrete' && main.foundation.type !== 'slab',
    electric: p.electric.enabled,
  });
  return { structure: main.structure, geo: main.geo, thermal: main.thermal, foundation: main.foundation, panels: main.panels, blocks, totals, estimate, schedule, entity, warnings };
}

export interface TechVariant {
  tech: FrameTech;
  selected: boolean;
  mass: number;
  kgPerM2: number;
  frameCost: number;
  total: number;
  weeks: number;
  ok: boolean;
}

/** Сравнение двух технологий каркаса основного здания */
export function compareTech(p: Project, settings: Settings, current: CalcResult): TechVariant[] {
  return (['welded', 'kmd'] as FrameTech[]).map((tech) => {
    const r = tech === current.structure.tech ? current : calcProject(p, settings, tech);
    const frame = r.estimate.sections.find((s) => s.id === 'frame');
    const design = r.estimate.sections.find((s) => s.id === 'design');
    return {
      tech,
      selected: tech === current.structure.tech,
      mass: r.totals.mass,
      kgPerM2: r.totals.kgPerM2,
      frameCost: (frame?.price ?? 0) + (design?.price ?? 0),
      total: r.estimate.totals.total,
      weeks: r.schedule.weeks,
      ok: r.structure.ok && !r.structure.warnings.some((w) => w.startsWith('Не удалось')),
    };
  });
}
