// Выгрузка сметы в Excel.

import writeXlsxFile, { type Row, type SheetData } from 'write-excel-file/universal';
import type { CalcResult } from '../domain/calc';
import { vatLabel } from '../domain/settings';
import type { Project } from '../domain/types';
import { downloadBlob, safeFileName } from './files';
import { dateRu } from './format';

const MONEY = '#,##0';
const QTY = '#,##0.00';
const HEAD = { fontWeight: 'bold' as const, backgroundColor: '#E8ECF0', wrap: true, align: 'center' as const, alignVertical: 'center' as const };

/** Смета для клиента (цены с наценкой) или внутренняя (с себестоимостью и маржой) */
export async function exportEstimate(p: Project, calc: CalcResult, internal: boolean): Promise<void> {
  const est = calc.estimate;
  const t = est.totals;
  const b = p.building;
  const k = t.price > 0 ? 1 : 0;
  const data: SheetData = [];
  const cols = internal ? 11 : 9;
  const title = (text: string, bold = false): Row => [{ value: text, columnSpan: cols, fontWeight: bold ? 'bold' : undefined, fontSize: bold ? 13 : undefined }];
  data.push(title(`Смета к коммерческому предложению № ${p.number} от ${dateRu(new Date())}`, true));
  data.push(title(`Объект: ${p.name || 'здание'} ${b.width}×${b.length} м, высота ${b.height} м${p.site.address ? `, ${p.site.address}` : ''}`));
  if (p.client.name) data.push(title(`Заказчик: ${p.client.name}`));
  if (calc.entity) data.push(title(`Исполнитель: ${calc.entity.name}`));
  data.push([null]);
  const head = ['№', 'Наименование', 'Ед.', 'Кол-во', 'Материалы, цена', 'Работы, цена', 'Материалы, сумма', 'Работы, сумма', 'Всего'];
  if (internal) head.push('Себестоимость', 'Наценка');
  data.push(head.map((h) => ({ value: h, ...HEAD })));

  let n = 0;
  for (const s of est.sections) {
    const row: Row = [{ value: s.title, columnSpan: 8, fontWeight: 'bold', backgroundColor: '#F3F5F7' }, null, null, null, null, null, null, null, { value: Math.round(s.price), format: MONEY, fontWeight: 'bold', backgroundColor: '#F3F5F7' }];
    if (internal) row.push({ value: Math.round(s.cost), format: MONEY, fontWeight: 'bold', backgroundColor: '#F3F5F7' }, { value: Math.round(s.price - s.cost), format: MONEY, fontWeight: 'bold', backgroundColor: '#F3F5F7' });
    data.push(row);
    for (const l of s.lines) {
      n++;
      const q = l.qty || 1;
      const line: Row = [
        { value: n, align: 'center' },
        { value: l.name, wrap: true },
        { value: l.unit, align: 'center' },
        { value: l.qty, format: QTY },
        { value: Math.round(l.priceMat / q), format: MONEY },
        { value: Math.round(l.priceWork / q), format: MONEY },
        { value: Math.round(l.priceMat), format: MONEY },
        { value: Math.round(l.priceWork), format: MONEY },
        { value: Math.round(l.price), format: MONEY },
      ];
      if (internal) line.push({ value: Math.round(l.costMat + l.costWork), format: MONEY }, { value: Math.round(l.price - l.costMat - l.costWork), format: MONEY });
      data.push(line);
    }
  }
  data.push([null]);
  const total = (label: string, value: number, bold = false): Row => [
    { value: label, columnSpan: 8, align: 'right', fontWeight: bold ? 'bold' : undefined },
    null, null, null, null, null, null, null,
    { value: Math.round(value), format: MONEY, fontWeight: bold ? 'bold' : undefined },
  ];
  if (t.contingency > 0 || t.discount > 0) data.push(total('Итого по разделам', t.price * k));
  if (t.contingency > 0) data.push(total(`Резерв на непредвиденные работы, ${p.commercial.contingency}%`, t.contingency));
  if (t.discount > 0) data.push(total(`Скидка, ${p.commercial.discount}%`, -t.discount));
  data.push(total('ВСЕГО', t.total, true));
  data.push(total(t.vatMode === 'included' ? `В том числе НДС ${t.vatRate}%` : vatLabel(calc.entity), t.vatMode === 'included' ? t.vat : 0));
  if (internal) {
    data.push([null]);
    data.push(total('Себестоимость', t.cost));
    data.push(total(`Маржа, ${t.marginPct.toFixed(1).replace('.', ',')}%`, t.margin, true));
  }

  const widths = [5, 58, 8, 11, 14, 14, 16, 16, 16, 16, 14].slice(0, cols).map((width) => ({ width }));
  const blob = await writeXlsxFile(data, { columns: widths, sheet: 'Смета', stickyRowsCount: 0 }).toBlob();
  downloadBlob(`${safeFileName(`Смета ${p.number} ${p.name}`)}${internal ? ' (внутренняя)' : ''}.xlsx`, blob);
}
