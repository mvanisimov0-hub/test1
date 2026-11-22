// Печатные листы: общая шапка и подробная смета для клиента.

import { Fragment } from 'react';
import type { CalcResult } from '../domain/calc';
import { vatLabel } from '../domain/settings';
import type { Project, Settings } from '../domain/types';
import { dateRu, nf, num, rub } from './format';

export function SheetHeader({ settings, calc }: { settings: Settings; calc: CalcResult }) {
  const e = calc.entity;
  return (
    <header className="sheet-head">
      <div>
        {settings.logo ? <img className="sheet-logo" src={settings.logo} alt="" /> : null}
        <div className="sheet-brand">
          {settings.brand}
          <small>{settings.slogan}</small>
        </div>
      </div>
      {e ? (
        <div className="sheet-req">
          <b>{e.name}</b>
          {e.inn ? (
            <div>
              ИНН {e.inn}
              {e.kpp ? ` / КПП ${e.kpp}` : ''}
            </div>
          ) : null}
          {e.address ? <div>{e.address}</div> : null}
          {e.phone || e.email ? <div>{[e.phone, e.email].filter(Boolean).join(' · ')}</div> : null}
          {settings.site ? <div>{settings.site}</div> : null}
        </div>
      ) : null}
    </header>
  );
}

/** Строки итогов: общие для КП и сметы */
export function TotalsRows({ project: p, calc, span }: { project: Project; calc: CalcResult; span: number }) {
  const t = calc.estimate.totals;
  return (
    <>
      {t.contingency > 0 || t.discount > 0 ? (
        <tr>
          <td colSpan={span}>Итого по разделам</td>
          <td className="r">{rub(t.price)}</td>
        </tr>
      ) : null}
      {t.contingency > 0 ? (
        <tr>
          <td colSpan={span}>Резерв на непредвиденные работы, {num(p.commercial.contingency)}%</td>
          <td className="r">{rub(t.contingency)}</td>
        </tr>
      ) : null}
      {t.discount > 0 ? (
        <tr>
          <td colSpan={span}>Скидка, {num(p.commercial.discount)}%</td>
          <td className="r">−{rub(t.discount)}</td>
        </tr>
      ) : null}
      <tr className="total">
        <td colSpan={span}>Всего, {vatLabel(calc.entity)}</td>
        <td className="r">{rub(t.total)}</td>
      </tr>
      {t.vatMode === 'included' ? (
        <tr>
          <td colSpan={span}>В том числе НДС {t.vatRate}%</td>
          <td className="r">{rub(t.vat)}</td>
        </tr>
      ) : null}
    </>
  );
}

export function EstimateSheet({ project: p, calc, settings, className = '' }: { project: Project; calc: CalcResult; settings: Settings; className?: string }) {
  const b = p.building;
  let n = 0;
  return (
    <article className={`sheet ${className}`}>
      <SheetHeader settings={settings} calc={calc} />
      <p className="p-muted">
        Приложение к коммерческому предложению № {p.number} от {dateRu(new Date())}
      </p>
      <h1>Смета</h1>
      <p>
        {p.name || 'Здание'} {num(b.width)}×{num(b.length)} м, высота {num(b.height)} м{p.site.address ? `. ${p.site.address}` : ''}
        {p.client.name ? `. Заказчик: ${p.client.name}` : ''}
      </p>
      <table style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>№</th>
            <th>Наименование</th>
            <th>Ед.</th>
            <th>Кол-во</th>
            <th>Материалы</th>
            <th>Работы</th>
            <th>Всего</th>
          </tr>
        </thead>
        <tbody>
          {calc.estimate.sections.map((s) => (
            <Fragment key={s.id}>
              <tr className="sec">
                <td colSpan={6}>{s.title}</td>
                <td className="r">{rub(s.price)}</td>
              </tr>
              {s.lines.map((l) => {
                n++;
                return (
                  <tr key={l.id}>
                    <td className="r">{n}</td>
                    <td>{l.name}</td>
                    <td>{l.unit}</td>
                    <td className="r">{nf(l.qty, l.qty % 1 ? 2 : 0)}</td>
                    <td className="r">{l.priceMat ? nf(l.priceMat) : '—'}</td>
                    <td className="r">{l.priceWork ? nf(l.priceWork) : '—'}</td>
                    <td className="r">{nf(l.price)}</td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
          <TotalsRows project={p} calc={calc} span={6} />
        </tbody>
      </table>
      <div className="sheet-foot">Суммы в рублях. Смета составлена по предварительному расчёту и уточняется после разработки проектной документации.</div>
    </article>
  );
}
