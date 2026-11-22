// Коммерческое предложение в Word: тот же состав, что у печатного КП, но текст можно править.

import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IBorderOptions,
  type IParagraphOptions,
  type IRunOptions,
} from 'docx';
import type { CalcResult } from '../domain/calc';
import { ralLabel } from '../domain/colors';
import { ROMAN } from '../domain/loads';
import { PRESETS } from '../domain/presets';
import { vatLabel } from '../domain/settings';
import { CORE_LABEL } from '../domain/thermal';
import type { Project, Settings } from '../domain/types';
import { downloadBlob, safeFileName } from './files';
import { dateRu, nf, num, plural, rub } from './format';
import { dataUrlToBytes, imageSize } from './svgImage';

export interface ProposalImages {
  hero?: string | null;
  frame?: string | null;
  drawings?: { title: string; dataUrl: string; width: number; height: number }[];
}

/** Размеры растровых картинок в пикселях — нужны для сохранения пропорций */
export interface ImageSizes {
  hero?: { width: number; height: number } | null;
  frame?: { width: number; height: number } | null;
}

const FONT = 'Arial';
const INK = '141B22';
const MUTED = '4B5866';
const LINE = 'CFD6DD';
const SOFT = 'F3F5F7';
const ACCENT = 'A83F29';
/** A4 и поля 15 мм в твипах; ширина полосы набора */
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 850;
const CONTENT = PAGE_W - 2 * MARGIN;
/** ширина картинки по полосе набора, пиксели при 96 dpi */
const IMG_W = 660;

const GATE: Record<string, string> = { sectional: 'секционные', swing: 'распашные', roller: 'рулонные' };

const thin: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const none: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'auto' };
const GRID = { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin };
const NO_GRID = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };

function run(text: string, opts: Partial<IRunOptions> = {}): TextRun {
  return new TextRun({ text, font: FONT, ...opts });
}

function para(content: string | TextRun[], opts: Partial<IParagraphOptions> = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    ...opts,
    children: typeof content === 'string' ? [run(content)] : content,
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 260, after: 120 },
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 2 } },
    children: [run(text.toUpperCase(), { bold: true, size: 22 })],
  });
}

function bullet(label: string, text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 40 },
    children: [run(`${label} `, { bold: true }), run(text)],
  });
}

interface CellSpec {
  text: string;
  right?: boolean;
  bold?: boolean;
  fill?: string;
  size?: number;
}

function cell(c: CellSpec | string, width: number): TableCell {
  const spec = typeof c === 'string' ? { text: c } : c;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    shading: spec.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: spec.fill } : undefined,
    children: [
      new Paragraph({
        alignment: spec.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [run(spec.text, { bold: spec.bold, size: spec.size })],
      }),
    ],
  });
}

/** Таблица на всю ширину полосы; widths — доли ширины колонок */
function table(rows: (CellSpec | string)[][], widths: number[], header?: string[]): Table {
  const total = widths.reduce((a, b) => a + b, 0);
  const cols = widths.map((w) => Math.round((w / total) * CONTENT));
  const body = rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, cols[i])) }));
  const head = header
    ? [new TableRow({ tableHeader: true, children: header.map((h, i) => cell({ text: h, bold: true, fill: SOFT }, cols[i])) })]
    : [];
  return new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: cols, borders: GRID, rows: [...head, ...body] });
}

function picture(dataUrl: string, size: { width: number; height: number }, width = IMG_W): Paragraph | null {
  const type = /^data:image\/png/i.test(dataUrl) ? 'png' : /^data:image\/jpe?g/i.test(dataUrl) ? 'jpg' : null;
  if (!type || !size.width || !size.height) return null;
  const data = dataUrlToBytes(dataUrl);
  if (!data.length) return null;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [new ImageRun({ type, data, transformation: { width, height: Math.round((width * size.height) / size.width) } })],
  });
}

/** Строки итогов — та же логика, что в печатном КП */
function totalsRows(p: Project, calc: CalcResult): CellSpec[][] {
  const t = calc.estimate.totals;
  const rows: CellSpec[][] = [];
  if (t.contingency > 0 || t.discount > 0) rows.push([{ text: 'Итого по разделам' }, { text: rub(t.price), right: true }]);
  if (t.contingency > 0) rows.push([{ text: `Резерв на непредвиденные работы, ${num(p.commercial.contingency)}%` }, { text: rub(t.contingency), right: true }]);
  if (t.discount > 0) rows.push([{ text: `Скидка, ${num(p.commercial.discount)}%` }, { text: `−${rub(t.discount)}`, right: true }]);
  rows.push([
    { text: `Всего, ${vatLabel(calc.entity)}`, bold: true, fill: SOFT, size: 22 },
    { text: rub(t.total), right: true, bold: true, fill: SOFT, size: 22 },
  ]);
  if (t.vatMode === 'included') rows.push([{ text: `В том числе НДС ${t.vatRate}%` }, { text: rub(t.vat), right: true }]);
  return rows;
}

/**
 * Документ КП. Функция не обращается к странице и браузеру: картинки приходят готовыми data URL,
 * их размеры — в sizes (без размеров принимаются пропорции снимков из 3D-вида).
 */
export function buildProposalDoc(p: Project, calc: CalcResult, settings: Settings, images: ProposalImages = {}, sizes: ImageSizes = {}): Document {
  const b = p.building;
  const st = calc.structure;
  const env = p.envelope;
  const geo = calc.geo;
  const t = calc.estimate.totals;
  const e = calc.entity;
  const today = new Date();
  const valid = new Date(today.getTime() + p.commercial.validDays * 86400000);
  const weeks = `${calc.schedule.weeks} ${plural(calc.schedule.weeks, 'неделя', 'недели', 'недель')}`;
  const typeLabel = PRESETS[b.type].label;
  const totalMass = calc.totals?.mass ?? st.mass.total;
  const totalArea = calc.totals?.totalFloorArea ?? geo.totalFloorArea;
  const children: (Paragraph | Table)[] = [];

  // ── шапка ──
  const brand = [
    para([run(settings.brand, { bold: true, size: 34 })], { spacing: { after: 20 } }),
    ...(settings.slogan ? [para([run(settings.slogan, { color: MUTED, size: 18 })], { spacing: { after: 0 } })] : []),
  ];
  const req: Paragraph[] = [];
  const reqLine = (text: string, bold = false) =>
    req.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [run(text, { bold, size: 18, color: bold ? INK : MUTED })] }));
  if (e) {
    reqLine(e.name, true);
    if (e.inn) reqLine(`ИНН ${e.inn}${e.kpp ? ` / КПП ${e.kpp}` : ''}`);
    if (e.address) reqLine(e.address);
    if (e.phone || e.email) reqLine([e.phone, e.email].filter(Boolean).join(' · '));
  }
  if (settings.site) reqLine(settings.site);
  if (!req.length) req.push(new Paragraph({ children: [] }));
  const half = Math.round(CONTENT / 2);
  children.push(
    new Table({
      width: { size: CONTENT, type: WidthType.DXA },
      columnWidths: [half, CONTENT - half],
      borders: { ...NO_GRID, bottom: { style: BorderStyle.SINGLE, size: 18, color: ACCENT } },
      rows: [
        new TableRow({
          children: [
            new TableCell({ width: { size: half, type: WidthType.DXA }, margins: { bottom: 100 }, children: brand }),
            new TableCell({ width: { size: CONTENT - half, type: WidthType.DXA }, margins: { bottom: 100 }, children: req }),
          ],
        }),
      ],
    }),
  );

  // ── заголовок ──
  const forWhom = p.client.name ? ` · для: ${p.client.name}${p.client.contact ? `, ${p.client.contact}` : ''}` : '';
  children.push(para([run(`Коммерческое предложение № ${p.number} от ${dateRu(today)}${forWhom}`, { color: MUTED })], { spacing: { before: 200, after: 80 } }));
  const title = `${typeLabel} ${num(b.width)}×${num(b.length)} м${p.name && !p.name.startsWith('Пример') ? ` — ${p.name}` : ''}`;
  children.push(para([run(title, { bold: true, size: 40 })], { spacing: { after: 100 } }));
  children.push(
    para(
      `Строительство здания из металлокаркаса${env.walls === 'sandwich' ? ' и сэндвич-панелей' : ''} «под ключ» в составе, указанном ниже.${p.site.address ? ` Адрес объекта: ${p.site.address}.` : ''}`,
    ),
  );

  if (images.hero) {
    const pic = picture(images.hero, sizes.hero ?? { width: 1400, height: 820 });
    if (pic) children.push(pic);
  }

  // ── цена ──
  children.push(
    new Table({
      width: { size: CONTENT, type: WidthType.DXA },
      columnWidths: [Math.round(CONTENT * 0.55), CONTENT - Math.round(CONTENT * 0.55)],
      borders: { ...NO_GRID, left: { style: BorderStyle.SINGLE, size: 36, color: ACCENT } },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: Math.round(CONTENT * 0.55), type: WidthType.DXA },
              margins: { top: 120, bottom: 120, left: 200, right: 100 },
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: SOFT },
              children: [
                para('Стоимость строительства', { spacing: { after: 20 } }),
                para([run(`${rub(t.perM2)} за м² · срок ${weeks}`, { color: MUTED })], { spacing: { after: 0 } }),
              ],
            }),
            new TableCell({
              width: { size: CONTENT - Math.round(CONTENT * 0.55), type: WidthType.DXA },
              margins: { top: 120, bottom: 120, left: 100, right: 200 },
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: SOFT },
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(rub(t.total), { bold: true, size: 40 })] })],
            }),
          ],
        }),
      ],
    }),
  );

  // ── параметры ──
  children.push(heading('Параметры здания'));
  const params: (CellSpec | string)[][] = [
    ['Размеры в осях', { text: `${num(b.width)} × ${num(b.length)} м`, right: true }],
    [`Площадь ${b.floors > 1 || calc.blocks.length > 1 ? 'общая' : 'здания'}`, { text: `${nf(totalArea, 0)} м²`, right: true }],
    ['Высота до низа конструкций', { text: `${num(b.height)} м`, right: true }],
    ['Высота в коньке', { text: `${nf(geo.ridgeHeight, 1)} м`, right: true }],
  ];
  if (b.floors > 1) {
    params.push(['Этажей', { text: `${b.floors}${b.floorLength && b.floorLength < b.length ? ` (антресоль ${num(b.floorLength)} м)` : ''}`, right: true }]);
  }
  params.push(
    ['Кровля', { text: `${b.roof === 'gable' ? 'двускатная' : 'односкатная'}, ${num(b.slopeDeg)}°`, right: true }],
    ['Шаг рам', { text: `${num(st.step, 2)} м`, right: true }],
    ['Снеговой / ветровой район', { text: `${ROMAN[p.site.snowDistrict]} / ${p.site.windDistrict}`, right: true }],
  );
  if (calc.blocks.length > 1) {
    const list = calc.blocks
      .slice(1)
      .map((blk) => {
        const ab = blk.project.building;
        return `${blk.label}: ${num(ab.width)}×${num(ab.length)} м, высота ${num(ab.height)} м`;
      })
      .join('; ');
    params.push(['Пристройки', { text: list, right: true }]);
  }
  children.push(table(params, [45, 55]));

  // ── стоимость по разделам ──
  children.push(heading('Стоимость по разделам'));
  const sections: (CellSpec | string)[][] = calc.estimate.sections.map((s) => [s.title, { text: rub(s.price), right: true }]);
  children.push(table([...sections, ...totalsRows(p, calc)], [68, 32]));

  // ── технические решения ──
  children.push(heading('Технические решения'));
  const col = st.groups.find((g) => g.key === 'colOuter');
  const colText = col ? col.section.charAt(0).toLowerCase() + col.section.slice(1) : '';
  const rafter = st.groups.find((g) => g.key === 'rafter');
  const roofStruct =
    st.scheme === 'truss'
      ? `стропильные фермы из профильной трубы пролётом ${num(st.spanLen, 1)} м`
      : `ригели рам из ${rafter?.section.startsWith('Двутавр') ? 'двутавра' : 'профильной трубы'} пролётом ${num(st.spanLen, 1)} м`;
  children.push(
    bullet(
      'Каркас:',
      `${st.tech === 'welded' ? 'стальной сварной, детали нарезаются и окрашиваются на заводе' : 'стальной, заводского изготовления по чертежам КМД, монтаж на болтах'}; колонны — ${colText}, покрытие — ${roofStruct}. Сталь ${p.frame.steel === 'C345' ? 'С345' : 'С255'}, масса каркаса ${nf(totalMass / 1000, 1)} т.`,
    ),
  );
  children.push(bullet('Защита металла:', `${p.frame.coating === 'primer' ? 'грунтование ГФ-021' : p.frame.coating === 'enamel' ? 'грунт-эмаль в два слоя' : 'горячее цинкование'}.`));
  if (env.walls !== 'none') {
    children.push(
      bullet(
        'Стены:',
        `${env.walls === 'sandwich' ? `сэндвич-панели ${env.wallThk} мм, утеплитель — ${CORE_LABEL[env.wallCore]}` : 'профилированный лист с полимерным покрытием'}, ${ralLabel(env.wallColor)}; ${nf(calc.totals?.wallNet ?? geo.wallNet, 0)} м².`,
      ),
    );
  }
  children.push(
    bullet(
      'Кровля:',
      `${env.roofing === 'sandwich' ? `сэндвич-панели ${env.roofThk} мм, утеплитель — ${CORE_LABEL[env.roofCore]}` : 'профилированный лист по прогонам'}, ${ralLabel(env.roofColor)}; ${nf(calc.totals?.roofArea ?? geo.roofArea, 0)} м²${env.gutters ? ', водосточная система' : ''}${env.snowGuards ? ', снегозадержатели' : ''}.`,
    ),
  );
  children.push(
    bullet(
      'Фундамент:',
      `${calc.foundation.title.toLowerCase()}${p.foundation.type !== 'slab' && p.foundation.floor === 'concrete' ? `; бетонный пол ${p.foundation.floorThk} мм${p.foundation.topping ? ' с упрочнением' : ''}` : ''}.`,
    ),
  );
  const openingText: string[] = [];
  for (const blk of calc.blocks) {
    if (blk.project.envelope.walls === 'none') continue;
    for (const o of blk.project.openings) {
      if (o.qty <= 0) continue;
      const size = `${num(o.w)}×${num(o.h)} м`;
      if (o.kind === 'gate') openingText.push(`ворота ${GATE[o.subtype] ?? ''} ${size} — ${o.qty} шт.${o.automation ? ' с электроприводом' : ''}`);
      else if (o.kind === 'door') openingText.push(`двери ${size} — ${o.qty} шт.`);
      else openingText.push(`${o.subtype === 'vitrage' ? 'витражи' : 'окна ПВХ'} ${size} — ${o.qty} шт.`);
    }
  }
  if (openingText.length) children.push(bullet('Проёмы:', `${openingText.join('; ').replace(/\.$/, '')}.`));
  const slabArea = calc.blocks.reduce((a, blk) => a + blk.geo.floorSlabArea, 0);
  if (slabArea > 0) children.push(bullet('Перекрытия:', `монолитные по профнастилу на стальных балках, ${nf(slabArea, 0)} м²; металлические лестницы.`));
  if (p.frame.crane.type !== 'none') {
    children.push(bullet('Кран:', `кран-балка ${p.frame.crane.type === 'bridge' ? 'опорная' : 'подвесная'} грузоподъёмностью ${num(p.frame.crane.capacity)} т.`));
  }
  if (p.electric.enabled) {
    children.push(
      bullet(
        'Электрика:',
        `${p.electric.level === 'basic' ? 'освещение и розеточная сеть' : p.electric.level === 'standard' ? 'освещение, розетки, распределительный щит' : 'освещение и силовая сеть под оборудование'}.`,
      ),
    );
  }

  if (images.frame) {
    const pic = picture(images.frame, sizes.frame ?? { width: 1000, height: 620 }, 420);
    if (pic) children.push(pic);
  }
  for (const d of images.drawings ?? []) {
    const pic = picture(d.dataUrl, d);
    if (!pic) continue;
    children.push(heading(d.title), pic);
  }

  // ── сроки ──
  children.push(heading('Сроки'));
  children.push(para(`Общий срок — ${weeks} от подписания договора и получения аванса.`));
  children.push(
    table(
      calc.schedule.stages.map((s) => [s.name, { text: String(s.start + 1), right: true }, { text: String(s.days), right: true }]),
      [56, 22, 22],
      ['Этап', 'Начало, рабочий день', 'Длительность, рабочих дней'],
    ),
  );

  // ── условия ──
  children.push(heading('Условия оплаты'));
  children.push(para(p.commercial.paymentTerms));

  const excluded = [
    'отопление, вентиляция, водоснабжение и канализация',
    'наружные сети и технологическое присоединение',
    'чистовая отделка помещений',
    'инженерные изыскания, экспертиза и получение разрешений',
    'благоустройство территории',
  ];
  if (p.foundation.type === 'customer') excluded.unshift('фундаменты (выполняет заказчик по нашему заданию)');
  if (!p.electric.enabled) excluded.unshift('электромонтажные работы');
  children.push(heading('В стоимость не входит'));
  for (const x of excluded) children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [run(x)] }));

  if (p.commercial.notes.trim()) {
    children.push(heading('Примечания'));
    for (const line of p.commercial.notes.split(/\r?\n/)) children.push(para(line));
  }

  children.push(heading('Срок действия и контакты'));
  children.push(para(`Предложение действительно до ${dateRu(valid)}. Цены на металлопрокат и панели фиксируются на дату подписания договора.`));
  children.push(
    para([
      run(p.manager.name || 'Менеджер проекта', { bold: true }),
      run(`${p.manager.phone ? ` · ${p.manager.phone}` : ''}${p.manager.email ? ` · ${p.manager.email}` : ''}`),
    ]),
  );

  children.push(
    new Paragraph({
      spacing: { before: 240 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 6 } },
      children: [
        run(
          'Стоимость и технические решения определены по предварительному расчёту и уточняются после разработки проектной документации и получения данных о грунтах. Предложение не является публичной офертой.',
          { size: 16, color: MUTED },
        ),
      ],
    }),
  );

  return new Document({
    creator: settings.brand,
    title: `Коммерческое предложение № ${p.number}`,
    styles: { default: { document: { run: { font: FONT, size: 20, color: INK } } } },
    sections: [
      {
        properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
        children,
      },
    ],
  });
}

/** Собрать КП в Word и отдать файл на сохранение */
export async function exportProposalDocx(p: Project, calc: CalcResult, settings: Settings, images: ProposalImages): Promise<void> {
  const sizes: ImageSizes = {
    hero: images.hero ? await imageSize(images.hero) : null,
    frame: images.frame ? await imageSize(images.frame) : null,
  };
  const doc = buildProposalDoc(p, calc, settings, images, sizes);
  const blob = await Packer.toBlob(doc);
  downloadBlob(`${safeFileName(`КП ${p.number} ${p.name}`)}.docx`, blob);
}
