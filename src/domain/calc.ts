// Точка входа расчётного ядра: проект + справочники → все результаты.

import { buildEstimate, type Estimate } from './estimate';
import { calcFoundation, type FoundationResult } from './foundation';
import { envelopeGeometry, type EnvelopeGeometry } from './geometry';
import { buildSchedule, type Schedule } from './schedule';
import { calcStructure } from './structure';
import type { StructureResult } from './structTypes';
import { calcThermal, type ThermalResult } from './thermal';
import type { FrameTech, LegalEntity, Project, Settings } from './types';

export interface CalcResult {
  structure: StructureResult;
  geo: EnvelopeGeometry;
  thermal: ThermalResult;
  foundation: FoundationResult;
  estimate: Estimate;
  schedule: Schedule;
  entity: LegalEntity | undefined;
  /** все замечания расчёта, требующие внимания менеджера */
  warnings: string[];
}

export function calcProject(p: Project, settings: Settings, forceTech?: FrameTech): CalcResult {
  const structure = calcStructure(p, forceTech);
  const geo = envelopeGeometry(p.building, p.envelope, p.openings, structure.roofOffset, structure.purlinH);
  const thermal = calcThermal(p.building, p.envelope, p.site);
  const foundation = calcFoundation(p, structure, geo);
  const entity = settings.entities.find((e) => e.id === p.commercial.entityId) ?? settings.entities[0];
  const estimate = buildEstimate(p, structure, geo, foundation, settings.prices, entity);
  const schedule = buildSchedule(p, structure, geo, foundation);
  const warnings = [...structure.warnings, ...thermal.notes, ...foundation.warnings];
  for (const o of p.openings) {
    if (p.envelope.walls !== 'none' && o.sill + o.h > geo.eaveHeight + 0.01 && (o.wall === 'left' || o.wall === 'right')) {
      warnings.push(`Проём ${o.w}×${o.h} м выше стены (${geo.eaveHeight.toFixed(1)} м): уменьшите высоту проёма или увеличьте высоту здания.`);
    }
  }
  return { structure, geo, thermal, foundation, estimate, schedule, entity, warnings };
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

/** Сравнение двух технологий каркаса на одном и том же здании */
export function compareTech(p: Project, settings: Settings, current: CalcResult): TechVariant[] {
  return (['welded', 'kmd'] as FrameTech[]).map((tech) => {
    const r = tech === current.structure.tech ? current : calcProject(p, settings, tech);
    const frame = r.estimate.sections.find((s) => s.id === 'frame');
    const design = r.estimate.sections.find((s) => s.id === 'design');
    return {
      tech,
      selected: tech === current.structure.tech,
      mass: r.structure.mass.total,
      kgPerM2: r.structure.mass.kgPerM2,
      frameCost: (frame?.price ?? 0) + (design?.price ?? 0),
      total: r.estimate.totals.total,
      weeks: r.schedule.weeks,
      ok: r.structure.ok && !r.structure.warnings.some((w) => w.startsWith('Не удалось')),
    };
  });
}
