// Схема блокировки: взаимное положение основного здания и пристроек на плане.

import { blockBounds } from '../domain/blocks';
import type { CalcResult } from '../domain/calc';
import { num } from './format';

export function SitePlan({ calc }: { calc: CalcResult }) {
  const [x0, z0, x1, z1] = calc.totals.bounds;
  const w = x1 - x0;
  const h = z1 - z0;
  const W = 1000;
  const pad = 70;
  const k = (W - 2 * pad) / Math.max(w, 1);
  const H = h * k + 2 * pad;
  // ось А (z = 0) — внизу, как на плане в осях
  const X = (x: number) => pad + (x - x0) * k;
  const Y = (z: number) => H - pad - (z - z0) * k;
  return (
    <div className="drawing">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Схема расположения блоков здания">
        {calc.blocks.map((blk, i) => {
          const [a, b, c, d] = blockBounds(blk.placement, blk.project.building);
          const bb = blk.project.building;
          const cx = (X(a) + X(c)) / 2;
          const cy = (Y(b) + Y(d)) / 2;
          const small = (c - a) * k < 150;
          return (
            <g key={blk.id || 'main'}>
              <rect
                x={X(a)}
                y={Y(d)}
                width={(c - a) * k}
                height={(d - b) * k}
                fill={i === 0 ? 'var(--surface-2)' : 'var(--blue-soft)'}
                stroke="var(--blue)"
                strokeWidth={i === 0 ? 2.5 : 1.8}
              />
              <text x={cx} y={cy - (small ? 0 : 6)} textAnchor="middle" fontSize={small ? 11 : 14} fontWeight={600} fill="var(--ink)" stroke="none">
                {blk.label}
              </text>
              <text x={cx} y={cy + (small ? 13 : 14)} textAnchor="middle" fontSize={small ? 10 : 12} fill="var(--ink-2)" stroke="none">
                {num(bb.width)}×{num(bb.length)} м, h = {num(bb.height)} м
              </text>
            </g>
          );
        })}
        <text x={pad} y={H - 22} fontSize={12} fill="var(--ink-2)" stroke="none">
          Габариты здания в плане: {num(w, 1)} × {num(h, 1)} м. Оси основного здания: 1 — слева, А — внизу.
        </text>
      </svg>
    </div>
  );
}
