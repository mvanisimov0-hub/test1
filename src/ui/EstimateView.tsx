// Смета: рабочая таблица менеджера с себестоимостью, правками и своими позициями.

import { Fragment, useState } from 'react';
import { SECTIONS, type EstimateLine, type SectionId } from '../domain/estimate';
import { uid } from '../domain/presets';
import { vatLabel } from '../domain/settings';
import { useApp } from '../state/store';
import { exportEstimate } from './exportXlsx';
import { Check, Field, Num } from './fields';
import { SANDBOX } from './files';
import { nf, num, rub } from './format';
import { EstimateSheet } from './Sheets';

export function EstimateView() {
  const { project: p, calc, patch, settings } = useApp();
  const [showCost, setShowCost] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const est = calc.estimate;
  const t = est.totals;
  const overridden = Object.keys(p.overrides).length;

  const setOverride = (l: EstimateLine, key: 'qty' | 'mat' | 'work', v: number) =>
    patch((d) => {
      const cur = { ...d.overrides[l.id] };
      if (Math.abs(v - l.base[key]) < 1e-9) delete cur[key];
      else cur[key] = v;
      if (Object.keys(cur).length) d.overrides[l.id] = cur;
      else delete d.overrides[l.id];
    });

  const editCustom = (id: string, fn: (c: (typeof p.customLines)[number]) => void) =>
    patch((d) => {
      const c = d.customLines.find((x) => x.id === id);
      if (c) fn(c);
    });

  const addCustom = (section: SectionId) =>
    patch((d) => void d.customLines.push({ id: uid(), section, name: '', unit: 'шт', qty: 1, mat: 0, work: 0 }));

  const doExport = async (internal: boolean) => {
    setBusy(true);
    setError('');
    try {
      await exportEstimate(p, calc, internal);
    } catch {
      setError('Не удалось сформировать файл Excel. Попробуйте ещё раз или распечатайте смету.');
    } finally {
      setBusy(false);
    }
  };

  const cols = showCost ? 9 : 8;
  let n = 0;
  const shown = SECTIONS.map((s) => ({ meta: s, data: est.sections.find((x) => x.id === s.id) })).filter((s) => s.data || s.meta.id === 'extra');

  return (
    <div className="page stack">
      <div className="row no-print">
        <h2 className="grow" style={{ fontSize: 18 }}>
          Смета
        </h2>
        <Check checked={showCost} onChange={setShowCost}>
          Показывать себестоимость
        </Check>
        {!SANDBOX ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => doExport(false)}>
              Excel для клиента
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => doExport(true)}>
              Excel внутренняя
            </button>
            <button type="button" className="btn primary" onClick={() => window.print()}>
              Печать сметы для клиента
            </button>
          </>
        ) : (
          <span className="muted small">Excel и печать работают в полной версии модуля</span>
        )}
      </div>
      {error ? <div className="notice bad no-print">{error}</div> : null}

      <div className="cols-2 no-print">
        <section className="card">
          <div className="card-head">
            <h3>Итог для клиента</h3>
            <span className="muted small">{vatLabel(calc.entity)}</span>
          </div>
          <div className="card-body">
            <dl className="dl">
              <dt>Сумма по разделам</dt>
              <dd className="num">{rub(t.price)}</dd>
              {t.contingency > 0 ? (
                <>
                  <dt>Резерв {num(p.commercial.contingency)}%</dt>
                  <dd className="num">{rub(t.contingency)}</dd>
                </>
              ) : null}
              {t.discount > 0 ? (
                <>
                  <dt>Скидка {num(p.commercial.discount)}%</dt>
                  <dd className="num">−{rub(t.discount)}</dd>
                </>
              ) : null}
              <dt>
                <b>Всего</b>
              </dt>
              <dd className="num" style={{ fontSize: 18, color: 'var(--accent)' }}>
                {rub(t.total)}
              </dd>
              {t.vatMode === 'included' ? (
                <>
                  <dt>В том числе НДС {t.vatRate}%</dt>
                  <dd className="num">{rub(t.vat)}</dd>
                </>
              ) : null}
              <dt>За м² общей площади</dt>
              <dd className="num">{rub(t.perM2)}</dd>
            </dl>
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h3>Экономика сделки</h3>
            <span className="muted small">клиент этого не видит</span>
          </div>
          <div className="card-body">
            <dl className="dl">
              <dt>Себестоимость материалов</dt>
              <dd className="num">{rub(t.costMat)}</dd>
              <dt>Себестоимость работ</dt>
              <dd className="num">{rub(t.costWork)}</dd>
              <dt>
                <b>Маржа</b>
              </dt>
              <dd className="num">
                <b>{rub(t.margin)}</b> · {nf(t.marginPct, 1)}%
              </dd>
            </dl>
            <div className="fields three" style={{ marginTop: 12 }}>
              <Field label="Наценка на материалы">
                <Num value={p.commercial.markupMat} min={0} max={300} unit="%" onChange={(v) => patch((d) => void (d.commercial.markupMat = v))} />
              </Field>
              <Field label="Наценка на работы">
                <Num value={p.commercial.markupWork} min={0} max={300} unit="%" onChange={(v) => patch((d) => void (d.commercial.markupWork = v))} />
              </Field>
              <Field label="Скидка">
                <Num value={p.commercial.discount} min={0} max={50} unit="%" onChange={(v) => patch((d) => void (d.commercial.discount = v))} />
              </Field>
            </div>
          </div>
        </section>
      </div>

      {overridden ? (
        <div className="notice no-print row">
          <span className="grow">
            Вручную изменено позиций: {overridden}. Изменённые значения выделены и не пересчитываются при правке габаритов.
          </span>
          <button type="button" className="btn sm" onClick={() => patch((d) => void (d.overrides = {}))}>
            Вернуть расчётные значения
          </button>
        </div>
      ) : null}

      <div className="table-wrap no-print">
        <table className="t">
          <thead>
            <tr>
              <th>№</th>
              <th>Наименование</th>
              <th>Ед.</th>
              <th className="r">Кол-во</th>
              <th className="r">Материал, ₽/ед.</th>
              <th className="r">Работа, ₽/ед.</th>
              {showCost ? <th className="r">Себестоимость</th> : null}
              <th className="r">Цена клиенту</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map(({ meta, data }) => (
              <Fragment key={meta.id}>
                <tr className="sec">
                  <td colSpan={showCost ? 6 : 6}>{meta.title}</td>
                  {showCost ? <td className="r">{data ? nf(data.cost) : '—'}</td> : null}
                  <td className="r">{data ? nf(data.price) : '—'}</td>
                  <td className="r">
                    <button type="button" className="btn sm ghost" onClick={() => addCustom(meta.id)} title="Добавить свою позицию в раздел">
                      + позиция
                    </button>
                  </td>
                </tr>
                {data?.lines.map((l) => {
                  n++;
                  const ov = p.overrides[l.id] ?? {};
                  return (
                    <tr key={l.id}>
                      <td className="r">{n}</td>
                      <td className="wrap">
                        {l.custom ? (
                          <input
                            className="input"
                            style={{ height: 28 }}
                            aria-label="Наименование позиции"
                            value={l.name === 'Дополнительная позиция' && !p.customLines.find((c) => c.id === l.id)?.name ? '' : l.name}
                            placeholder="Наименование позиции"
                            onChange={(e) => editCustom(l.id, (c) => void (c.name = e.target.value))}
                          />
                        ) : (
                          l.name
                        )}
                        {l.note ? <div className="muted small">{l.note}</div> : null}
                      </td>
                      <td>
                        {l.custom ? (
                          <input
                            className="cell-input"
                            style={{ width: 54, textAlign: 'left' }}
                            aria-label="Единица измерения"
                            value={l.unit}
                            onChange={(e) => editCustom(l.id, (c) => void (c.unit = e.target.value))}
                          />
                        ) : (
                          l.unit
                        )}
                      </td>
                      <td className="r">
                        <Num
                          className={`cell-input${ov.qty != null ? ' changed' : ''}`}
                          ariaLabel="Количество"
                          value={l.qty}
                          min={0}
                          onChange={(v) => (l.custom ? editCustom(l.id, (c) => void (c.qty = v)) : setOverride(l, 'qty', v))}
                        />
                      </td>
                      <td className="r">
                        <Num
                          className={`cell-input${ov.mat != null ? ' changed' : ''}`}
                          ariaLabel="Цена материала за единицу"
                          value={l.mat}
                          min={0}
                          onChange={(v) => (l.custom ? editCustom(l.id, (c) => void (c.mat = v)) : setOverride(l, 'mat', v))}
                        />
                      </td>
                      <td className="r">
                        <Num
                          className={`cell-input${ov.work != null ? ' changed' : ''}`}
                          ariaLabel="Цена работы за единицу"
                          value={l.work}
                          min={0}
                          onChange={(v) => (l.custom ? editCustom(l.id, (c) => void (c.work = v)) : setOverride(l, 'work', v))}
                        />
                      </td>
                      {showCost ? <td className="r">{nf(l.costMat + l.costWork)}</td> : null}
                      <td className="r">{nf(l.price)}</td>
                      <td className="r">
                        {l.custom ? (
                          <button type="button" className="btn sm ghost danger" onClick={() => patch((d) => void (d.customLines = d.customLines.filter((c) => c.id !== l.id)))}>
                            Убрать
                          </button>
                        ) : l.overridden ? (
                          <button type="button" className="btn sm ghost" title="Вернуть расчётные значения строки" onClick={() => patch((d) => void delete d.overrides[l.id])}>
                            ↺
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            <tr className="total">
              <td colSpan={6}>Итого по разделам</td>
              {showCost ? <td className="r">{nf(t.cost)}</td> : null}
              <td className="r">{nf(t.price)}</td>
              <td />
            </tr>
            {t.contingency > 0 ? (
              <tr>
                <td colSpan={cols - 2}>Резерв на непредвиденные работы, {num(p.commercial.contingency)}%</td>
                <td className="r">{nf(t.contingency)}</td>
                <td />
              </tr>
            ) : null}
            {t.discount > 0 ? (
              <tr>
                <td colSpan={cols - 2}>Скидка, {num(p.commercial.discount)}%</td>
                <td className="r">−{nf(t.discount)}</td>
                <td />
              </tr>
            ) : null}
            <tr className="total">
              <td colSpan={cols - 2}>Всего, {vatLabel(calc.entity)}</td>
              <td className="r">{nf(t.total)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted small no-print">
        Количество и цены в строках можно править прямо в таблице. Цена клиенту = себестоимость × наценка (материалы {num(p.commercial.markupMat)}%, работы {num(p.commercial.markupWork)}%). Справочные цены
        меняются в разделе «Цены».
      </p>

      <EstimateSheet project={p} calc={calc} settings={settings} className="print-only" />
    </div>
  );
}
