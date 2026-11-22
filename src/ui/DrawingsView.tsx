// Раздел «Чертежи»: планы и разрезы, фасады с раскладкой панелей, схемы каркаса.

import { useState } from 'react';
import type { BlockCalc, CalcResult } from '../domain/calc';
import type { WallSide } from '../domain/types';
import { useApp } from '../state/store';
import { PlanDrawing, SectionDrawing } from './Drawings';
import { FacadeDrawing, PanelSchedule, RoofLayoutDrawing } from './Facades';
import { Seg } from './fields';
import { SANDBOX } from './files';
import { FrameSchemes } from './FrameSchemes';
import { SitePlan } from './SitePlan';

type Part = 'plans' | 'facades' | 'schemes';

const PARTS: { value: Part; label: string }[] = [
  { value: 'plans', label: 'Планы и разрезы' },
  { value: 'facades', label: 'Фасады и раскладка панелей' },
  { value: 'schemes', label: 'Схемы каркаса' },
];

/** Названия фасадов: для основного здания — по осям, для пристройки — по положению относительно стены примыкания */
export function facadeTitle(blk: BlockCalc, wall: WallSide): string {
  if (blk.id === '') {
    return { front: 'Торец по оси 1', back: 'Торец по последней цифровой оси', left: 'Продольная стена по оси А', right: 'Продольная стена по последней буквенной оси' }[wall];
  }
  const side = !blk.project.building.openSides?.includes('front');
  if (side) return { left: 'Сторона примыкания', right: 'Наружная продольная стена', front: 'Торец со стороны начала', back: 'Торец со стороны конца' }[wall];
  return { front: 'Сторона примыкания', back: 'Дальний торец', left: 'Боковая стена 1', right: 'Боковая стена 2' }[wall];
}

/** Блок как самостоятельный расчёт — для чертежей, которые принимают расчёт целиком */
export function blockAsCalc(calc: CalcResult, blk: BlockCalc): CalcResult {
  return { ...calc, structure: blk.structure, geo: blk.geo, thermal: blk.thermal, foundation: blk.foundation, panels: blk.panels };
}

export const FACADE_ORDER: WallSide[] = ['left', 'right', 'front', 'back'];

export function DrawingsView() {
  const { calc, moveOpening } = useApp();
  const [part, setPart] = useState<Part>('plans');
  const [blockId, setBlockId] = useState('');
  const blk = calc.blocks.find((x) => x.id === blockId) ?? calc.blocks[0];
  const view = blockAsCalc(calc, blk);
  const hasWalls = blk.project.envelope.walls !== 'none';
  const walls = FACADE_ORDER.filter((w) => !blk.project.building.openSides?.includes(w));
  return (
    <div className="page stack">
      <div className="row no-print">
        <h2 className="grow" style={{ fontSize: 18 }}>
          Чертежи
        </h2>
        {!SANDBOX ? (
          <button type="button" className="btn" onClick={() => window.print()}>
            Печать
          </button>
        ) : null}
      </div>
      <div className="row no-print">
        <Seg<Part> value={part} options={PARTS} onChange={setPart} label="Вид чертежей" />
        {calc.blocks.length > 1 ? <Seg<string> value={blk.id} options={calc.blocks.map((x) => ({ value: x.id, label: x.label }))} onChange={setBlockId} label="Блок здания" /> : null}
      </div>

      {part === 'plans' ? (
        <>
          {calc.blocks.length > 1 ? (
            <section>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                Схема блоков здания
              </div>
              <SitePlan calc={calc} />
            </section>
          ) : null}
          <section>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              План в осях — {blk.label.toLowerCase()}
            </div>
            <PlanDrawing project={blk.project} calc={view} />
          </section>
          <section>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Поперечный разрез — {blk.label.toLowerCase()}
            </div>
            <SectionDrawing project={blk.project} calc={view} />
          </section>
        </>
      ) : null}

      {part === 'facades' ? (
        <>
          {hasWalls ? (
            <p className="muted small no-print">
              Проёмы перетаскиваются мышью: по горизонтали — привязка, у окон по вертикали — отметка низа. Шаг 5 см. Раскладка панелей, ведомости и смета пересчитываются сразу.
            </p>
          ) : null}
          {hasWalls
            ? walls.map((w) => (
                <section key={w}>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    {facadeTitle(blk, w)}
                  </div>
                  <FacadeDrawing block={blk} wall={w} onMove={(id, index, u, sill) => moveOpening(blk.id, id, index, u, sill)} />
                </section>
              ))
            : null}
          <section>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Раскладка кровли
            </div>
            <RoofLayoutDrawing block={blk} />
          </section>
          <PanelSchedule block={blk} />
        </>
      ) : null}

      {part === 'schemes' ? <FrameSchemes block={blk} /> : null}
    </div>
  );
}
