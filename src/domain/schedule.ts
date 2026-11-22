// Укрупнённый график работ в рабочих днях.

import type { FoundationResult } from './foundation';
import type { EnvelopeGeometry } from './geometry';
import type { StructureResult } from './structTypes';
import type { Project } from './types';

export interface Stage {
  id: string;
  name: string;
  /** начало и длительность, рабочие дни */
  start: number;
  days: number;
}

export interface Schedule {
  stages: Stage[];
  totalDays: number;
  weeks: number;
}

export function buildSchedule(p: Project, st: StructureResult, geo: EnvelopeGeometry, fnd: FoundationResult): Schedule {
  const t = st.mass.total / 1000;
  const welded = st.tech === 'welded';
  const stages: Stage[] = [];
  const push = (id: string, name: string, start: number, days: number) => {
    const d = Math.max(1, Math.round(days));
    stages.push({ id, name, start: Math.round(start), days: d });
    return Math.round(start) + d;
  };

  const designDays = welded ? 6 + Math.min(8, t * 0.4) : 12 + Math.min(20, t * 0.25);
  const designEnd = push('design', welded ? 'Проектирование: АР, КМ' : 'Проектирование: АР, КМ, КМД', 0, designDays);

  const fabDays = welded ? 6 + t / 3 : 14 + t / 3.5;
  const fabEnd = push('fab', 'Изготовление металлоконструкций', designEnd, fabDays);
  push('panels', 'Изготовление и поставка панелей', designEnd, 15);

  let fndEnd = designEnd;
  if (fnd.type !== 'customer') {
    const fndDays =
      fnd.type === 'screw'
        ? 2 + fnd.piles / 25
        : fnd.type === 'slab'
          ? 8 + geo.floorArea / 120 + 5
          : 8 + fnd.concrete / 6 + 5;
    fndEnd = push('foundation', 'Фундаменты', Math.max(4, designEnd - 4), fndDays);
  }

  const frameStart = Math.max(fabEnd, fndEnd);
  const frameEnd = push('frame', 'Монтаж каркаса', frameStart, 2 + t / (welded ? 1.5 : 3));

  let end = frameEnd;
  const panelArea = geo.wallNet + geo.roofArea;
  const panelEnd = push('envelope', p.envelope.walls === 'none' ? 'Монтаж кровли' : 'Монтаж стен и кровли', frameEnd, 2 + panelArea / 150);
  end = panelEnd;

  if (geo.floorSlabArea > 0) end = Math.max(end, push('slabs', 'Перекрытия и лестницы', frameEnd, 4 + geo.floorSlabArea / 60));
  const openCount = p.openings.reduce((s, o) => s + o.qty, 0);
  if (openCount > 0 && p.envelope.walls !== 'none') end = Math.max(end, push('openings', 'Ворота, двери, окна', panelEnd - 2, 1 + openCount / 4));
  if (p.foundation.floor === 'concrete' && fnd.type !== 'slab') end = Math.max(end, push('floor', 'Бетонные полы', panelEnd - 3, 3 + geo.floorArea / 180));
  if (p.electric.enabled) end = Math.max(end, push('electric', 'Электромонтажные работы', panelEnd - 2, 3 + geo.totalFloorArea / 150));
  end = push('handover', 'Сдача объекта', end, 2);

  return { stages, totalDays: end, weeks: Math.ceil(end / 5) };
}
