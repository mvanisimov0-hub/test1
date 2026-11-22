// Коммерческое предложение: печатный документ для клиента.

import { useEffect, useRef, useState } from 'react';
import { ralLabel } from '../domain/colors';
import { ROMAN } from '../domain/loads';
import { PRESETS } from '../domain/presets';
import { CORE_LABEL } from '../domain/thermal';
import { useApp } from '../state/store';
import { PlanDrawing, SectionDrawing } from './Drawings';
import { FACADE_ORDER, blockAsCalc, facadeTitle } from './DrawingsView';
import { exportProposalDocx } from './exportDocx';
import { FacadeDrawing, PanelSchedule, RoofLayoutDrawing } from './Facades';
import { SitePlan } from './SitePlan';
import { svgToPng } from './svgImage';
import { Check } from './fields';
import { SANDBOX } from './files';
import { dateRu, nf, num, plural, rub } from './format';
import { EstimateSheet, SheetHeader, TotalsRows } from './Sheets';
import { renderSnapshot } from './Viewer3D';

const GATE: Record<string, string> = { sectional: 'секционные', swing: 'распашные', roller: 'рулонные' };

export function ProposalView() {
  const { project: p, calc, settings } = useApp();
  const [withEstimate, setWithEstimate] = useState(false);
  const [withFacades, setWithFacades] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const docRef = useRef<HTMLDivElement>(null);

  // Word: чертежи со страницы превращаются в картинки и вставляются в документ
  const toWord = async () => {
    setBusy(true);
    setError('');
    try {
      const drawings: { title: string; dataUrl: string; width: number; height: number }[] = [];
      const nodes = docRef.current?.querySelectorAll<HTMLElement>('[data-drawing]') ?? [];
      for (const node of nodes) {
        const svg = node.querySelector('svg');
        if (!svg) continue;
        const img = await svgToPng(svg as SVGSVGElement);
        if (img) drawings.push({ title: node.dataset.drawing ?? '', ...img });
      }
      await exportProposalDocx(p, calc, settings, { hero, frame: frameShot, drawings });
    } catch {
      setError('Не удалось сформировать документ Word. Попробуйте ещё раз или сохраните КП в PDF через печать.');
    } finally {
      setBusy(false);
    }
  };
  const [hero, setHero] = useState<string | null>(null);
  const [frameShot, setFrameShot] = useState<string | null>(null);
  const b = p.building;
  const st = calc.structure;
  const env = p.envelope;
  const geo = calc.geo;
  const t = calc.estimate.totals;

  // картинки здания для документа; пересоздаются после паузы в правках
  useEffect(() => {
    const id = window.setTimeout(() => {
      setHero(renderSnapshot(p, calc, 'clad', 'iso'));
      setFrameShot(renderSnapshot(p, calc, 'frame', 'iso', 1000, 620));
    }, 250);
    return () => window.clearTimeout(id);
  }, [p, calc]);

  const typeLabel = PRESETS[b.type].label;
  const today = new Date();
  const valid = new Date(today.getTime() + p.commercial.validDays * 86400000);
  const col = st.groups.find((g) => g.key === 'colOuter');
  const roofStruct =
    st.scheme === 'truss'
      ? `стропильные фермы из профильной трубы пролётом ${num(st.spanLen, 1)} м`
      : `ригели рам из ${st.groups.find((g) => g.key === 'rafter')?.section.startsWith('Двутавр') ? 'двутавра' : 'профильной трубы'} пролётом ${num(st.spanLen, 1)} м`;

  const openings = p.openings.filter((o) => o.qty > 0 && env.walls !== 'none');
  const openingText = openings.map((o) => {
    const size = `${num(o.w)}×${num(o.h)} м`;
    if (o.kind === 'gate') return `ворота ${GATE[o.subtype] ?? ''} ${size} — ${o.qty} шт.${o.automation ? ' с электроприводом' : ''}`;
    if (o.kind === 'door') return `двери ${size} — ${o.qty} шт.`;
    return `${o.subtype === 'vitrage' ? 'витражи' : 'окна ПВХ'} ${size} — ${o.qty} шт.`;
  });

  const excluded = [
    'отопление, вентиляция, водоснабжение и канализация',
    'наружные сети и технологическое присоединение',
    'чистовая отделка помещений',
    'инженерные изыскания, экспертиза и получение разрешений',
    'благоустройство территории',
  ];
  if (p.foundation.type === 'customer') excluded.unshift('фундаменты (выполняет заказчик по нашему заданию)');
  if (!p.electric.enabled) excluded.unshift('электромонтажные работы');

  return (
    <div>
      <div className="doc-toolbar no-print">
        <h2 className="grow" style={{ fontSize: 18 }}>
          Коммерческое предложение
        </h2>
        <Check checked={withEstimate} onChange={setWithEstimate}>
          Приложить подробную смету
        </Check>
        <Check checked={withFacades} onChange={setWithFacades}>
          Приложить фасады и раскладку панелей
        </Check>
        {!SANDBOX ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={toWord}>
              {busy ? 'Формируется…' : 'Скачать Word'}
            </button>
            <button type="button" className="btn primary" onClick={() => window.print()}>
              Печать / сохранить в PDF
            </button>
          </>
        ) : (
          <span className="muted small">Печать в PDF и выгрузка в Word работают в полной версии модуля</span>
        )}
      </div>
      {!p.client.name || !p.manager.name ? (
        <div className="doc-toolbar no-print">
          <div className="notice grow">
            Перед отправкой заполните {[!p.client.name ? 'клиента (раздел «Объект и клиент»)' : '', !p.manager.name ? 'менеджера (раздел «Коммерция»)' : ''].filter(Boolean).join(' и ')}.
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="doc-toolbar no-print">
          <div className="notice bad grow">{error}</div>
        </div>
      ) : null}

      <div ref={docRef}>
      <article className="sheet">
        <SheetHeader settings={settings} calc={calc} />
        <p className="p-muted">
          Коммерческое предложение № {p.number} от {dateRu(today)}
          {p.client.name ? ` · для: ${p.client.name}${p.client.contact ? `, ${p.client.contact}` : ''}` : ''}
        </p>
        <h1>
          {typeLabel} {num(b.width)}×{num(b.length)} м{p.name && !p.name.startsWith('Пример') ? ` — ${p.name}` : ''}
        </h1>
        <p>
          Строительство здания из металлокаркаса{env.walls === 'sandwich' ? ' и сэндвич-панелей' : ''} «под ключ» в составе, указанном ниже.
          {p.site.address ? ` Адрес объекта: ${p.site.address}.` : ''}
        </p>

        {hero ? <img className="sheet-hero" src={hero} alt="Общий вид здания" /> : <div className="sheet-hero" style={{ aspectRatio: '1400 / 820' }} />}

        <div className="sheet-price avoid-break">
          <div>
            <div>Стоимость строительства</div>
            <div className="p-muted">
              {rub(t.perM2)} за м² · срок {calc.schedule.weeks} {plural(calc.schedule.weeks, 'неделя', 'недели', 'недель')}
            </div>
          </div>
          <b>{rub(t.total)}</b>
        </div>

        <div className="sheet-grid">
          <div className="avoid-break">
            <h2>Параметры здания</h2>
            <table>
              <tbody>
                <tr>
                  <td>Размеры в осях</td>
                  <td className="r">
                    {num(b.width)} × {num(b.length)} м
                  </td>
                </tr>
                <tr>
                  <td>Площадь {b.floors > 1 || calc.blocks.length > 1 ? 'общая' : 'здания'}</td>
                  <td className="r">{nf(calc.totals.totalFloorArea, 0)} м²</td>
                </tr>
                <tr>
                  <td>Высота до низа конструкций</td>
                  <td className="r">{num(b.height)} м</td>
                </tr>
                <tr>
                  <td>Высота в коньке</td>
                  <td className="r">{nf(geo.ridgeHeight, 1)} м</td>
                </tr>
                {b.floors > 1 ? (
                  <tr>
                    <td>Этажей</td>
                    <td className="r">
                      {b.floors}
                      {b.floorLength && b.floorLength < b.length ? ` (антресоль ${num(b.floorLength)} м)` : ''}
                    </td>
                  </tr>
                ) : null}
                {calc.blocks.slice(1).map((x) => (
                  <tr key={x.id}>
                    <td>{x.label}</td>
                    <td className="r">
                      {num(x.project.building.width)} × {num(x.project.building.length)} м, h = {num(x.project.building.height)} м
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>Кровля</td>
                  <td className="r">
                    {b.roof === 'gable' ? 'двускатная' : 'односкатная'}, {num(b.slopeDeg)}°
                  </td>
                </tr>
                <tr>
                  <td>Шаг рам</td>
                  <td className="r">{num(st.step, 2)} м</td>
                </tr>
                <tr>
                  <td>Снеговой / ветровой район</td>
                  <td className="r">
                    {ROMAN[p.site.snowDistrict]} / {p.site.windDistrict}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="avoid-break">
            <h2>Стоимость по разделам</h2>
            <table>
              <tbody>
                {calc.estimate.sections.map((s) => (
                  <tr key={s.id}>
                    <td>{s.title}</td>
                    <td className="r">{rub(s.price)}</td>
                  </tr>
                ))}
                <TotalsRows project={p} calc={calc} span={1} />
              </tbody>
            </table>
          </div>
        </div>
      </article>

      <article className="sheet">
        <h2 style={{ marginTop: 0 }}>Технические решения</h2>
        <div className="sheet-grid">
          <div>
            <ul>
              <li>
                <b>Каркас:</b> {st.tech === 'welded' ? 'стальной сварной, детали нарезаются и окрашиваются на заводе' : 'стальной, заводского изготовления по чертежам КМД, монтаж на болтах'}; колонны —{' '}
                {col ? col.section.charAt(0).toLowerCase() + col.section.slice(1) : ''}, покрытие — {roofStruct}. Сталь {p.frame.steel === 'C345' ? 'С345' : 'С255'}, масса каркаса {nf(calc.totals.mass / 1000, 1)} т.
              </li>
              <li>
                <b>Защита металла:</b> {p.frame.coating === 'primer' ? 'грунтование ГФ-021' : p.frame.coating === 'enamel' ? 'грунт-эмаль в два слоя' : 'горячее цинкование'}.
              </li>
              {env.walls !== 'none' ? (
                <li>
                  <b>Стены:</b>{' '}
                  {env.walls === 'sandwich' ? `сэндвич-панели ${env.wallThk} мм, утеплитель — ${CORE_LABEL[env.wallCore]}` : 'профилированный лист с полимерным покрытием'}, {ralLabel(env.wallColor)};{' '}
                  {nf(calc.totals.wallNet, 0)} м².
                </li>
              ) : null}
              <li>
                <b>Кровля:</b> {env.roofing === 'sandwich' ? `сэндвич-панели ${env.roofThk} мм, утеплитель — ${CORE_LABEL[env.roofCore]}` : 'профилированный лист по прогонам'}, {ralLabel(env.roofColor)};{' '}
                {nf(calc.totals.roofArea, 0)} м²{env.gutters ? ', водосточная система' : ''}
                {env.snowGuards ? ', снегозадержатели' : ''}.
              </li>
              <li>
                <b>Фундамент:</b> {calc.foundation.title.toLowerCase()}
                {p.foundation.type !== 'slab' && p.foundation.floor === 'concrete' ? `; бетонный пол ${p.foundation.floorThk} мм${p.foundation.topping ? ' с упрочнением' : ''}` : ''}.
              </li>
              {openingText.length ? (
                <li>
                  <b>Проёмы:</b> {openingText.join('; ').replace(/\.$/, '')}.
                </li>
              ) : null}
              {b.floors > 1 ? (
                <li>
                  <b>Перекрытия:</b> монолитные по профнастилу на стальных балках, {nf(geo.floorSlabArea, 0)} м²; металлические лестницы.
                </li>
              ) : null}
              {p.frame.crane.type !== 'none' ? (
                <li>
                  <b>Кран:</b> кран-балка {p.frame.crane.type === 'bridge' ? 'опорная' : 'подвесная'} грузоподъёмностью {num(p.frame.crane.capacity)} т.
                </li>
              ) : null}
              {p.electric.enabled ? (
                <li>
                  <b>Электрика:</b> {p.electric.level === 'basic' ? 'освещение и розеточная сеть' : p.electric.level === 'standard' ? 'освещение, розетки, распределительный щит' : 'освещение и силовая сеть под оборудование'}.
                </li>
              ) : null}
            </ul>
          </div>
          <div>{frameShot ? <img className="sheet-hero" style={{ margin: 0 }} src={frameShot} alt="Каркас здания" /> : null}</div>
        </div>

        {calc.blocks.length > 1 ? (
          <div className="avoid-break" data-drawing="Схема блоков здания">
            <h2>Схема блоков здания</h2>
            <SitePlan calc={calc} />
          </div>
        ) : null}
        <div className="avoid-break" data-drawing="План в осях">
          <h2>План в осях</h2>
          <PlanDrawing project={p} calc={calc} />
        </div>
        <div className="avoid-break" data-drawing="Поперечный разрез">
          <h2>Поперечный разрез</h2>
          <SectionDrawing project={p} calc={calc} />
        </div>
        {calc.blocks.slice(1).map((x) => (
          <div key={x.id} className="avoid-break" data-drawing={`${x.label}: разрез`}>
            <h2>{x.label}: разрез</h2>
            <SectionDrawing project={x.project} calc={blockAsCalc(calc, x)} />
          </div>
        ))}
      </article>

      <article className="sheet">
        <h2 style={{ marginTop: 0 }}>Сроки</h2>
        <p>
          Общий срок — {calc.schedule.weeks} {plural(calc.schedule.weeks, 'неделя', 'недели', 'недель')} от подписания договора и получения аванса.
        </p>
        <table>
          <thead>
            <tr>
              <th>Этап</th>
              <th>Начало, рабочий день</th>
              <th>Длительность, рабочих дней</th>
            </tr>
          </thead>
          <tbody>
            {calc.schedule.stages.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="r">{s.start + 1}</td>
                <td className="r">{s.days}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="sheet-grid">
          <div className="avoid-break">
            <h2>Условия оплаты</h2>
            <p>{p.commercial.paymentTerms}</p>
          </div>
          <div className="avoid-break">
            <h2>В стоимость не входит</h2>
            <ul>
              {excluded.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        </div>

        {p.commercial.notes ? (
          <div className="avoid-break">
            <h2>Примечания</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{p.commercial.notes}</p>
          </div>
        ) : null}

        <div className="avoid-break">
          <h2>Срок действия и контакты</h2>
          <p>
            Предложение действительно до {dateRu(valid)}. Цены на металлопрокат и панели фиксируются на дату подписания договора.
          </p>
          <p>
            <b>{p.manager.name || 'Менеджер проекта'}</b>
            {p.manager.phone ? ` · ${p.manager.phone}` : ''}
            {p.manager.email ? ` · ${p.manager.email}` : ''}
          </p>
        </div>

        <div className="sheet-foot">
          Стоимость и технические решения определены по предварительному расчёту и уточняются после разработки проектной документации и получения данных о грунтах. Предложение не является публичной
          офертой.
        </div>
      </article>

      {withFacades
        ? calc.blocks.map((x) => (
            <article className="sheet" key={x.id || 'main'}>
              <h2 style={{ marginTop: 0 }}>Фасады и раскладка панелей — {x.label.toLowerCase()}</h2>
              {x.project.envelope.walls !== 'none'
                ? FACADE_ORDER.filter((w) => !x.project.building.openSides?.includes(w)).map((w) => (
                    <div key={w} className="avoid-break" data-drawing={`${x.label}: ${facadeTitle(x, w).toLowerCase()}`}>
                      <p className="p-muted" style={{ margin: '8px 0 4px' }}>
                        {facadeTitle(x, w)}
                      </p>
                      <FacadeDrawing block={x} wall={w} />
                    </div>
                  ))
                : null}
              <div className="avoid-break" data-drawing={`${x.label}: раскладка кровли`}>
                <p className="p-muted" style={{ margin: '8px 0 4px' }}>
                  Раскладка кровли
                </p>
                <RoofLayoutDrawing block={x} />
              </div>
              <PanelSchedule block={x} />
            </article>
          ))
        : null}
      </div>

      {withEstimate ? <EstimateSheet project={p} calc={calc} settings={settings} /> : null}
    </div>
  );
}
