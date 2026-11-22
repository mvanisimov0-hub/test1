import { describe, expect, it } from 'vitest';
import { FemModel, forcesAt } from '../src/domain/fem';

const EA = 1e6;
const EI = 2e4;

describe('МКЭ: сверка с аналитическими решениями', () => {
  it('консоль с силой на конце: прогиб PL³/3EI, момент в заделке PL', () => {
    const L = 4;
    const P = 10;
    const m = new FemModel(
      [{ x: 0, y: 0, fix: [true, true, true] }, { x: L, y: 0 }],
      [{ n1: 0, n2: 1, EA, EI }],
    );
    const r = m.solve({ nodal: [{ node: 1, fx: 0, fy: -P, mz: 0 }], dist: [] });
    expect(r.disp[4]).toBeCloseTo((-P * L ** 3) / (3 * EI), 8);
    expect(forcesAt(r.elems[0], 0).M).toBeCloseTo(-P * L, 6);
    expect(r.reactions[1]).toBeCloseTo(P, 6);
    expect(r.reactions[2]).toBeCloseTo(P * L, 6);
  });

  it('шарнирная балка с равномерной нагрузкой: M = qL²/8, прогиб 5qL⁴/384EI', () => {
    const L = 6;
    const q = 5;
    const m = new FemModel(
      [
        { x: 0, y: 0, fix: [true, true, false] },
        { x: L / 2, y: 0 },
        { x: L, y: 0, fix: [false, true, false] },
      ],
      [
        { n1: 0, n2: 1, EA, EI },
        { n1: 1, n2: 2, EA, EI },
      ],
    );
    const r = m.solve({
      nodal: [],
      dist: [
        { elem: 0, qx: 0, qy: -q },
        { elem: 1, qx: 0, qy: -q },
      ],
    });
    expect(forcesAt(r.elems[0], L / 2).M).toBeCloseTo((q * L * L) / 8, 6);
    expect(r.disp[4]).toBeCloseTo((-5 * q * L ** 4) / (384 * EI), 8);
    expect(r.reactions[1]).toBeCloseTo((q * L) / 2, 6);
  });

  it('защемлённая балка с равномерной нагрузкой: опорный момент qL²/12, пролётный qL²/24', () => {
    const L = 6;
    const q = 5;
    const m = new FemModel(
      [
        { x: 0, y: 0, fix: [true, true, true] },
        { x: L, y: 0, fix: [true, true, true] },
      ],
      [{ n1: 0, n2: 1, EA, EI }],
    );
    const r = m.solve({ nodal: [], dist: [{ elem: 0, qx: 0, qy: -q }] });
    expect(forcesAt(r.elems[0], 0).M).toBeCloseTo((-q * L * L) / 12, 6);
    expect(forcesAt(r.elems[0], L / 2).M).toBeCloseTo((q * L * L) / 24, 6);
  });

  it('балка «заделка — шарнир» с равномерной нагрузкой: опорный момент qL²/8, реакция 3qL/8', () => {
    const L = 8;
    const q = 3;
    const m = new FemModel(
      [
        { x: 0, y: 0, fix: [true, true, true] },
        { x: L, y: 0, fix: [true, true, true] },
      ],
      [{ n1: 0, n2: 1, EA, EI, rel2: true }],
    );
    const r = m.solve({ nodal: [], dist: [{ elem: 0, qx: 0, qy: -q }] });
    expect(forcesAt(r.elems[0], 0).M).toBeCloseTo((-q * L * L) / 8, 6);
    expect(forcesAt(r.elems[0], L).M).toBeCloseTo(0, 6);
    expect(r.reactions[4]).toBeCloseTo((3 * q * L) / 8, 6);
  });

  it('балка «шарнир — заделка» (шарнир в начале стержня): те же значения зеркально', () => {
    const L = 8;
    const q = 3;
    const m = new FemModel(
      [
        { x: 0, y: 0, fix: [true, true, true] },
        { x: L, y: 0, fix: [true, true, true] },
      ],
      [{ n1: 0, n2: 1, EA, EI, rel1: true }],
    );
    const r = m.solve({ nodal: [], dist: [{ elem: 0, qx: 0, qy: -q }] });
    expect(forcesAt(r.elems[0], 0).M).toBeCloseTo(0, 6);
    expect(forcesAt(r.elems[0], L).M).toBeCloseTo((-q * L * L) / 8, 6);
    expect(r.reactions[1]).toBeCloseTo((3 * q * L) / 8, 6);
    expect(r.reactions[4]).toBeCloseTo((5 * q * L) / 8, 6);
  });

  it('консоль с шарниром в начале второго стержня: момент через шарнир не передаётся', () => {
    // заделка — стержень — шарнир — стержень — шарнирная опора; сила в шарнире
    const m = new FemModel(
      [{ x: 0, y: 0, fix: [true, true, true] }, { x: 3, y: 0 }, { x: 6, y: 0, fix: [false, true, false] }],
      [
        { n1: 0, n2: 1, EA, EI },
        { n1: 1, n2: 2, EA, EI, rel1: true },
      ],
    );
    const r = m.solve({ nodal: [{ node: 1, fx: 0, fy: -12, mz: 0 }], dist: [] });
    // второй стержень шарнирный с обоих концов по факту (шарнир + шарнирная опора): вся сила идёт в консоль
    expect(forcesAt(r.elems[0], 0).M).toBeCloseTo(-36, 6);
    expect(r.reactions[1]).toBeCloseTo(12, 6);
    expect(r.reactions[7]).toBeCloseTo(0, 6);
  });

  it('П-образная рама с шарнирными опорами и горизонтальной силой: M в узле = P·h/2', () => {
    const h = 5;
    const l = 8;
    const P = 20;
    const m = new FemModel(
      [
        { x: 0, y: 0, fix: [true, true, false] },
        { x: 0, y: h },
        { x: l, y: h },
        { x: l, y: 0, fix: [true, true, false] },
      ],
      [
        { n1: 0, n2: 1, EA, EI },
        { n1: 1, n2: 2, EA, EI },
        { n1: 3, n2: 2, EA, EI },
      ],
    );
    const r = m.solve({ nodal: [{ node: 1, fx: P, fy: 0, mz: 0 }], dist: [] });
    // по симметрии жёсткостей распор делится пополам (с точностью до обжатия ригеля)
    expect(Math.abs(forcesAt(r.elems[0], h).M)).toBeCloseTo((P * h) / 2, 1);
    expect(r.reactions[0] + r.reactions[9]).toBeCloseTo(-P, 6);
    // вертикальные реакции уравновешивают опрокидывающий момент
    expect(r.reactions[10]).toBeCloseTo((P * h) / l, 6);
  });

  it('треугольная ферма: усилия в стержнях по вырезанию узлов', () => {
    // пролёт 8 м, высота 3 м, сила 40 кН в коньке
    const P = 40;
    const m = new FemModel(
      [
        { x: 0, y: 0, fix: [true, true, false] },
        { x: 8, y: 0, fix: [false, true, false] },
        { x: 4, y: 3 },
      ],
      [
        { n1: 0, n2: 2, EA, EI, rel1: true, rel2: true },
        { n1: 2, n2: 1, EA, EI, rel1: true, rel2: true },
        { n1: 0, n2: 1, EA, EI, rel1: true, rel2: true },
      ],
    );
    const r = m.solve({ nodal: [{ node: 2, fx: 0, fy: -P, mz: 0 }], dist: [] });
    // стропильная нога: N = −(P/2)/sinα, sinα = 3/5; затяжка: N = (P/2)·ctgα
    expect(forcesAt(r.elems[0], 0).N).toBeCloseTo(-(P / 2) / 0.6, 6);
    expect(forcesAt(r.elems[2], 0).N).toBeCloseTo((P / 2) * (4 / 3), 6);
  });

  it('шарнирно опёртый стержень (rel1+rel2) с поперечной нагрузкой даёт qL²/8', () => {
    const L = 5;
    const q = 4;
    const m = new FemModel(
      [
        { x: 0, y: 0, fix: [true, true, true] },
        { x: L, y: 0, fix: [true, true, true] },
      ],
      [{ n1: 0, n2: 1, EA, EI, rel1: true, rel2: true }],
    );
    const r = m.solve({ nodal: [], dist: [{ elem: 0, qx: 0, qy: -q }] });
    expect(forcesAt(r.elems[0], L / 2).M).toBeCloseTo((q * L * L) / 8, 6);
    expect(forcesAt(r.elems[0], 0).Q).toBeCloseTo((q * L) / 2, 6);
  });

  it('геометрически изменяемая система даёт ошибку', () => {
    expect(
      () =>
        new FemModel(
          [
            { x: 0, y: 0, fix: [true, true, false] },
            { x: 4, y: 0 },
          ],
          [{ n1: 0, n2: 1, EA, EI }],
        ),
    ).toThrow();
  });
});
