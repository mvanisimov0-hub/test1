// Укрупнённый график работ в рабочих днях.

import type { FoundationResult } from './foundation';

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

/** Суммарные объёмы по всем блокам здания */
export interface ScheduleInput {
  massT: number;
  welded: boolean;
  floorArea: number;
  totalFloorArea: number;
  panelArea: number;
  floorSlabArea: number;
  foundation: FoundationResult['type'];
  piles: number;
  concrete: number;
  openCount: number;
  walls: boolean;
  concreteFloor: boolean;
  electric: boolean;
}

export function buildSchedule(q: ScheduleInput): Schedule {
  const t = q.massT;
  const welded = q.welded;
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
  if (q.foundation !== 'customer') {
    const fndDays =
      q.foundation === 'screw'
        ? 2 + q.piles / 25
        : q.foundation === 'slab'
          ? 8 + q.floorArea / 120 + 5
          : 8 + q.concrete / 6 + 5;
    fndEnd = push('foundation', 'Фундаменты', Math.max(4, designEnd - 4), fndDays);
  }

  const frameStart = Math.max(fabEnd, fndEnd);
  const frameEnd = push('frame', 'Монтаж каркаса', frameStart, 2 + t / (welded ? 1.5 : 3));

  let end = frameEnd;
  const panelArea = q.panelArea;
  const panelEnd = push('envelope', !q.walls ? 'Монтаж кровли' : 'Монтаж стен и кровли', frameEnd, 2 + panelArea / 150);
  end = panelEnd;

  if (q.floorSlabArea > 0) end = Math.max(end, push('slabs', 'Перекрытия и лестницы', frameEnd, 4 + q.floorSlabArea / 60));
  const openCount = q.openCount;
  if (openCount > 0 && q.walls) end = Math.max(end, push('openings', 'Ворота, двери, окна', panelEnd - 2, 1 + openCount / 4));
  if (q.concreteFloor) end = Math.max(end, push('floor', 'Бетонные полы', panelEnd - 3, 3 + q.floorArea / 180));
  if (q.electric) end = Math.max(end, push('electric', 'Электромонтажные работы', panelEnd - 2, 3 + q.totalFloorArea / 150));
  end = push('handover', 'Сдача объекта', end, 2);

  return { stages, totalDays: end, weeks: Math.ceil(end / 5) };
}
