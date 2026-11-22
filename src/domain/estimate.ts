// Смета: позиции по разделам, себестоимость (материалы и работы), наценки, скидка, НДС.

import type { FoundationResult } from './foundation';
import type { EnvelopeGeometry } from './geometry';
import type { PanelsResult } from './panels';
import { priceMap, type PriceMap } from './prices';
import type { StructureResult } from './structTypes';
import { CORE_LABEL } from './thermal';
import type { CoreType, LegalEntity, PriceItem, Project } from './types';

export const SECTIONS = [
  { id: 'design', title: 'Проектирование' },
  { id: 'foundation', title: 'Фундаменты и полы' },
  { id: 'frame', title: 'Металлокаркас' },
  { id: 'envelope', title: 'Стены и кровля' },
  { id: 'openings', title: 'Ворота, двери, окна' },
  { id: 'floors', title: 'Перекрытия, лестницы, перегородки' },
  { id: 'electric', title: 'Электроснабжение и освещение' },
  { id: 'logistics', title: 'Доставка и организация работ' },
  { id: 'extra', title: 'Дополнительные позиции' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export interface EstimateLine {
  id: string;
  section: SectionId;
  name: string;
  unit: string;
  qty: number;
  /** себестоимость за единицу */
  mat: number;
  work: number;
  /** расчётные значения до ручной правки */
  base: { qty: number; mat: number; work: number };
  overridden: boolean;
  custom: boolean;
  costMat: number;
  costWork: number;
  /** цена для клиента с наценкой */
  priceMat: number;
  priceWork: number;
  price: number;
  note?: string;
}

export interface SectionTotal {
  id: SectionId;
  title: string;
  lines: EstimateLine[];
  cost: number;
  costMat: number;
  costWork: number;
  price: number;
  priceMat: number;
  priceWork: number;
}

export interface EstimateTotals {
  cost: number;
  costMat: number;
  costWork: number;
  /** сумма с наценкой до резерва и скидки */
  price: number;
  contingency: number;
  discount: number;
  /** итог для клиента */
  total: number;
  vatMode: LegalEntity['vatMode'];
  vatRate: number;
  vat: number;
  margin: number;
  marginPct: number;
  perM2: number;
}

export interface Estimate {
  sections: SectionTotal[];
  totals: EstimateTotals;
}

const GATE_NAME: Record<string, string> = { sectional: 'секционные подъёмные', swing: 'распашные утеплённые', roller: 'рулонные' };
const DOOR_NAME: Record<string, string> = { steel: 'металлическая утеплённая', fire: 'противопожарная EI60', alu: 'алюминиевая остеклённая' };
const WINDOW_NAME: Record<string, string> = { pvc: 'Окно ПВХ', vitrage: 'Витраж алюминиевый' };

function panelPrice(pm: PriceMap, kind: 'wall' | 'roof', core: CoreType, thk: number): number {
  const base = pm[`panel.${kind}.${core}`].mat;
  const per10 = pm[`panel.${kind}.${core}.per10`].mat;
  return Math.max(0, base + ((thk - 100) / 10) * per10);
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

interface RawLine {
  id: string;
  section: SectionId;
  name: string;
  unit: string;
  qty: number;
  mat: number;
  work: number;
  note?: string;
}

/** Один блок здания (основное здание или пристройка) с результатами его расчёта */
export interface EstimateBlock {
  /** пустая строка для основного здания, идентификатор — для пристройки */
  id: string;
  label: string;
  project: Project;
  structure: StructureResult;
  geo: EnvelopeGeometry;
  foundation: FoundationResult;
  panels: PanelsResult;
}

/** Позиции разделов 1–7 для одного блока */
function blockLines(p: Project, st: StructureResult, geo: EnvelopeGeometry, fnd: FoundationResult, panels: PanelsResult, pm: PriceMap): RawLine[] {
  const raw: RawLine[] = [];
  const add = (id: string, section: SectionId, name: string, unit: string, qty: number, mat: number, work: number, note?: string) => {
    if (!(qty > 0)) return;
    raw.push({ id, section, name, unit, qty, mat, work, note });
  };
  const byPrice = (id: string, section: SectionId, priceId: string, qty: number, name?: string, note?: string) => {
    const it = pm[priceId];
    add(id, section, name ?? it.name, it.unit, qty, it.mat, it.work, note);
  };

  const b = p.building;
  const env = p.envelope;
  const massT = st.mass.total / 1000;
  const welded = st.tech === 'welded';

  // 1. Проектирование
  byPrice('design.ar', 'design', 'design.ar', r1(geo.totalFloorArea));
  byPrice('design.km', 'design', welded ? 'design.km.welded' : 'design.km.kmd', r1(geo.totalFloorArea));
  if (!welded) byPrice('design.kmd', 'design', 'design.kmd', r2(massT));
  if (p.foundation.type !== 'customer') byPrice('design.kj', 'design', 'design.kj', r1(geo.floorArea));

  // 2. Фундаменты и полы
  fnd.items.forEach((it, i) => byPrice(`found.${i}.${it.priceId}`, 'foundation', it.priceId, r2(it.qty), it.name, it.note));
  const slab = p.foundation.type === 'slab';
  if (p.foundation.floor === 'concrete' && !slab) {
    byPrice('floor.prep', 'foundation', 'found.prep', r1(geo.floorArea), 'Подготовка под полы: песок, щебень, плёнка');
    byPrice('floor.concrete', 'foundation', 'floor.concrete', r2((geo.floorArea * p.foundation.floorThk) / 1000), `Бетонный пол ${p.foundation.floorThk} мм`);
  }
  if (p.foundation.topping && (slab || p.foundation.floor === 'concrete')) byPrice('floor.topping', 'foundation', 'floor.topping', r1(geo.floorArea));
  if (p.foundation.blindArea) byPrice('found.blind', 'foundation', 'found.blind', r1(geo.perimeter + 4));

  // 3. Металлокаркас
  const waste = 1.03;
  const metal = (id: string, priceId: string, kg: number) => byPrice(id, 'frame', priceId, r2((kg / 1000) * waste), undefined, 'с учётом отходов на раскрой 3%');
  metal('steel.tube', 'steel.tube', st.mass.tube);
  metal('steel.ibeam', 'steel.ibeam', st.mass.ibeam);
  metal('steel.channel', 'steel.channel', st.mass.channel);
  metal('steel.plate', 'steel.plate', st.mass.plate);
  if (p.frame.steel === 'C345') byPrice('steel.c345', 'frame', 'steel.c345', r2(massT * waste));
  if (welded) {
    byPrice('fab.cut', 'frame', 'fab.welded.cut', r2(massT));
    byPrice('fab.truss', 'frame', 'fab.welded.truss', r2(st.mass.truss / 1000));
  } else {
    byPrice('fab.kmd', 'frame', 'fab.kmd', r2(massT));
    byPrice('fab.bolts', 'frame', 'fab.kmd.bolts', r2(massT));
  }
  if (p.frame.coating === 'enamel') byPrice('coat', 'frame', 'coat.enamel', r2(massT));
  if (p.frame.coating === 'zinc') byPrice('coat', 'frame', 'coat.zinc', r2(massT));
  byPrice('mount.frame', 'frame', welded ? 'mount.welded' : 'mount.kmd', r2(massT));
  if (p.frame.crane.type !== 'none') {
    const it = pm[p.frame.crane.type === 'bridge' ? 'crane.bridge' : 'crane.suspended'];
    const k = (Math.max(0.5, p.frame.crane.capacity) / 5) ** 0.7;
    add(
      'crane.unit',
      'frame',
      `Кран-балка ${p.frame.crane.type === 'bridge' ? 'опорная' : 'подвесная'} ${p.frame.crane.capacity} т с тельфером, монтаж и пусконаладка`,
      'шт',
      1,
      Math.round((it.mat * k) / 1000) * 1000,
      Math.round((it.work * k) / 1000) * 1000,
    );
    if (p.frame.crane.type === 'bridge') byPrice('crane.rail', 'frame', 'crane.rail', r1(2 * b.length * b.spans));
  }

  // 4. Стены и кровля
  // количество панелей — по раскладке: заказная площадь с учётом подрезки
  const wallQty = r1(panels.wallArea);
  const roofQty = r1(panels.roofArea);
  if (env.walls === 'sandwich') {
    add('wall.panel', 'envelope', `Сэндвич-панели стеновые ${env.wallThk} мм, ${CORE_LABEL[env.wallCore]}`, 'м²', wallQty, panelPrice(pm, 'wall', env.wallCore, env.wallThk), pm['mount.panel.wall'].work);
  } else if (env.walls === 'proflist') {
    byPrice('wall.proflist', 'envelope', 'proflist.wall', wallQty);
  }
  if (env.roofing === 'sandwich') {
    add('roof.panel', 'envelope', `Сэндвич-панели кровельные ${env.roofThk} мм, ${CORE_LABEL[env.roofCore]}`, 'м²', roofQty, panelPrice(pm, 'roof', env.roofCore, env.roofThk), pm['mount.panel.roof'].work);
  } else {
    byPrice('roof.proflist', 'envelope', 'proflist.roof', roofQty);
  }
  for (const t of panels.trims) byPrice(t.priceId, 'envelope', t.priceId, r1(t.length), undefined, `${t.pieces} шт. по 3 м: ${t.where}`);
  byPrice('fasteners', 'envelope', 'fasteners', r1(geo.wallNet + geo.roofArea));
  if (env.gutters) byPrice('gutter', 'envelope', 'gutter', r1(geo.gutterLength + geo.downpipes * geo.eaveHeight));
  if (env.snowGuards) byPrice('snowguard', 'envelope', 'snowguard', r1(geo.gutterLength));

  // 5. Проёмы
  if (env.walls !== 'none') {
    for (const o of p.openings) {
      if (o.qty <= 0) continue;
      const size = `${o.w.toString().replace('.', ',')}×${o.h.toString().replace('.', ',')} м`;
      if (o.kind === 'gate') {
        const it = pm[`gate.${o.subtype}`] ?? pm['gate.sectional'];
        add(`open.${o.id}`, 'openings', `Ворота ${GATE_NAME[o.subtype] ?? ''} ${size}, ${o.qty} шт.`, 'м²', r2(o.w * o.h * o.qty), it.mat, it.work);
        if (o.automation) byPrice(`open.${o.id}.auto`, 'openings', 'gate.auto', o.qty);
      } else if (o.kind === 'door') {
        const it = pm[`door.${o.subtype}`] ?? pm['door.steel'];
        if (it.unit === 'м²') add(`open.${o.id}`, 'openings', `Дверь ${DOOR_NAME[o.subtype] ?? ''} ${size}, ${o.qty} шт.`, 'м²', r2(o.w * o.h * o.qty), it.mat, it.work);
        else add(`open.${o.id}`, 'openings', `Дверь ${DOOR_NAME[o.subtype] ?? ''} ${size}`, 'шт', o.qty, it.mat, it.work);
      } else {
        const it = pm[`window.${o.subtype}`] ?? pm['window.pvc'];
        add(`open.${o.id}`, 'openings', `${WINDOW_NAME[o.subtype] ?? 'Окно'} ${size}, ${o.qty} шт.`, 'м²', r2(o.w * o.h * o.qty), it.mat, it.work);
      }
    }
  }

  // 6. Перекрытия, лестницы, перегородки
  if (geo.floorSlabArea > 0) byPrice('slab.deck', 'floors', 'slab.deck', r1(geo.floorSlabArea));
  const levelArea = b.floors > 1 ? geo.floorSlabArea / (b.floors - 1) : 0;
  const stairs = p.stairs ?? (b.floors > 1 ? (b.floors - 1) * Math.max(1, Math.ceil(levelArea / 500)) : 0);
  if (stairs > 0) byPrice('stairs', 'floors', 'stairs.metal', stairs);
  if (env.partitionsArea > 0) {
    add('partitions', 'floors', `Перегородки из сэндвич-панелей ${env.partitionThk} мм, минеральная вата`, 'м²', r1(env.partitionsArea), panelPrice(pm, 'wall', 'mw', env.partitionThk), pm['mount.panel.wall'].work);
  }

  // 7. Электрика
  if (p.electric.enabled) byPrice('electric', 'electric', `electric.${p.electric.level}`, r1(geo.totalFloorArea));

  return raw;
}

function panelVolume(p: Project, geo: EnvelopeGeometry): number {
  const env = p.envelope;
  return (
    (env.walls === 'sandwich' ? (geo.wallNet * env.wallThk) / 1000 : geo.wallNet * 0.03) +
    (env.roofing === 'sandwich' ? (geo.roofArea * env.roofThk) / 1000 : geo.roofArea * 0.05)
  );
}

export function buildEstimate(p: Project, blocks: EstimateBlock[], prices: PriceItem[], entity: LegalEntity | undefined): Estimate {
  const pm = priceMap(prices);
  // позиции блоков объединяются: одинаковые по наименованию и ценам складываются,
  // отличающиеся у пристройки идут отдельной строкой с её названием
  const raw: RawLine[] = [];
  const index = new Map<string, RawLine>();
  for (const blk of blocks) {
    for (const l of blockLines(blk.project, blk.structure, blk.geo, blk.foundation, blk.panels, pm)) {
      const key = `${l.section}|${l.name}|${l.unit}|${l.mat}|${l.work}`;
      const same = index.get(key);
      if (same) {
        same.qty = Math.round((same.qty + l.qty) * 100) / 100;
        continue;
      }
      const line = blk.id ? { ...l, id: `${blk.id}:${l.id}`, name: `${l.name} — ${blk.label.toLowerCase()}` } : l;
      index.set(key, line);
      raw.push(line);
    }
  }
  const add = (id: string, section: SectionId, name: string, unit: string, qty: number, mat: number, work: number) => {
    if (qty > 0) raw.push({ id, section, name, unit, qty, mat, work });
  };

  // 8. Доставка и организация работ
  const massT = blocks.reduce((a, x) => a + x.structure.mass.total, 0) / 1000;
  const volume = blocks.reduce((a, x) => a + panelVolume(x.project, x.geo), 0);
  const panelArea = blocks.reduce((a, x) => a + x.geo.wallNet + x.geo.roofArea, 0);
  const hasOpenings = blocks.some((x) => x.project.openings.length > 0);
  const welded = blocks[0].structure.tech === 'welded';
  // загрузка машин: металл по массе (20 т), панели по объёму (70 м³), ворота и окна — докладкой
  const trips = Math.max(1, Math.ceil(massT / 20 + volume / 70 + (hasOpenings ? 0.3 : 0) - 1e-9));
  const trip = Math.max(pm['delivery.min'].work, p.site.deliveryKm * pm['delivery.km'].work);
  add('delivery', 'logistics', `Доставка материалов на объект, ${p.site.deliveryKm} км`, 'рейс', trips, 0, Math.round(trip));
  const shifts = Math.ceil(massT / (welded ? 1.5 : 3)) + Math.ceil(panelArea / 250);
  add('machinery', 'logistics', pm['machinery.shift'].name, pm['machinery.shift'].unit, Math.max(1, shifts), pm['machinery.shift'].mat, pm['machinery.shift'].work);

  // ручные правки и свои позиции
  const mm = 1 + p.commercial.markupMat / 100;
  const mw = 1 + p.commercial.markupWork / 100;
  const finish = (l: RawLine, custom: boolean): EstimateLine => {
    const ov = custom ? undefined : p.overrides[l.id];
    const qty = ov?.qty ?? l.qty;
    const mat = ov?.mat ?? l.mat;
    const work = ov?.work ?? l.work;
    const costMat = qty * mat;
    const costWork = qty * work;
    return {
      id: l.id,
      section: l.section,
      name: l.name,
      unit: l.unit,
      qty,
      mat,
      work,
      base: { qty: l.qty, mat: l.mat, work: l.work },
      overridden: !!ov && (ov.qty != null || ov.mat != null || ov.work != null),
      custom,
      costMat,
      costWork,
      priceMat: costMat * mm,
      priceWork: costWork * mw,
      price: costMat * mm + costWork * mw,
      note: l.note,
    };
  };
  const lines = raw.map((l) => finish(l, false));
  for (const c of p.customLines) {
    const section = (SECTIONS.some((s) => s.id === c.section) ? c.section : 'extra') as SectionId;
    lines.push(finish({ id: c.id, section, name: c.name || 'Дополнительная позиция', unit: c.unit, qty: c.qty, mat: c.mat, work: c.work }, true));
  }

  // доли от стоимости работ считаются после всех остальных позиций
  const worksCost = lines.reduce((s, l) => s + l.costWork, 0);
  const pct = (id: string, priceId: string, name: string) => {
    const rate = pm[priceId].work;
    if (rate > 0) lines.push(finish({ id, section: 'logistics', name, unit: 'компл', qty: 1, mat: 0, work: Math.round((worksCost * rate) / 100) }, false));
  };
  pct('site', 'site.pct', 'Организация площадки: бытовки, ограждение, охрана труда');
  if (p.site.deliveryKm > 150) pct('travel', 'travel.pct', 'Командировочные расходы и проживание бригад');

  const sections: SectionTotal[] = SECTIONS.map((s) => {
    const ls = lines.filter((l) => l.section === s.id);
    const sum = (f: (l: EstimateLine) => number) => ls.reduce((a, l) => a + f(l), 0);
    return {
      id: s.id,
      title: s.title,
      lines: ls,
      costMat: sum((l) => l.costMat),
      costWork: sum((l) => l.costWork),
      cost: sum((l) => l.costMat + l.costWork),
      priceMat: sum((l) => l.priceMat),
      priceWork: sum((l) => l.priceWork),
      price: sum((l) => l.price),
    };
  }).filter((s) => s.lines.length);

  const costMat = sections.reduce((a, s) => a + s.costMat, 0);
  const costWork = sections.reduce((a, s) => a + s.costWork, 0);
  const cost = costMat + costWork;
  const price = sections.reduce((a, s) => a + s.price, 0);
  const contingency = (price * p.commercial.contingency) / 100;
  const discount = ((price + contingency) * p.commercial.discount) / 100;
  const total = Math.round(price + contingency - discount);
  const vatMode = entity?.vatMode ?? 'none';
  const vatRate = entity?.vatRate ?? 0;
  const vat = vatMode === 'included' ? (total * vatRate) / (100 + vatRate) : 0;
  const margin = total - cost;
  const area = blocks.reduce((a, x) => a + x.geo.totalFloorArea, 0);
  return {
    sections,
    totals: {
      cost,
      costMat,
      costWork,
      price,
      contingency,
      discount,
      total,
      vatMode,
      vatRate,
      vat,
      margin,
      marginPct: total > 0 ? (margin / total) * 100 : 0,
      perM2: area > 0 ? total / area : 0,
    },
  };
}
