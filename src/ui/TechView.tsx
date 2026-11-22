// Технические решения и расчётная записка: что подобрано и на каком основании.

import { Fragment, useMemo, useState } from 'react';
import { compareTech } from '../domain/calc';
import { ralLabel } from '../domain/colors';
import { ROMAN } from '../domain/loads';
import { CORE_LABEL } from '../domain/thermal';
import { useApp } from '../state/store';
import { Util } from './fields';
import { SANDBOX } from './files';
import { SCHEME_LABEL, TECH_LABEL, nf, num, plural, rub } from './format';

function Status({ s }: { s: 'ok' | 'reduced' | 'low' | 'na' }) {
  if (s === 'ok') return <span className="pill ok">соответствует</span>;
  if (s === 'reduced') return <span className="pill warn">ниже поэлементной нормы</span>;
  if (s === 'low') return <span className="pill bad">недостаточно</span>;
  return <span className="pill">не нормируется</span>;
}

export function Gantt() {
  const { calc } = useApp();
  const total = Math.max(1, calc.schedule.totalDays);
  return (
    <div className="gantt">
      {calc.schedule.stages.map((s) => (
        <Fragment key={s.id}>
          <span>{s.name}</span>
          <span className="gantt-track" title={`с ${s.start + 1}-го по ${s.start + s.days}-й рабочий день`}>
            <i style={{ left: `${(s.start / total) * 100}%`, width: `${(s.days / total) * 100}%` }} />
          </span>
          <span className="num muted" style={{ textAlign: 'right' }}>
            {s.days} дн
          </span>
        </Fragment>
      ))}
    </div>
  );
}

export function TechView() {
  const { project: p, calc, settings, patch } = useApp();
  const st = calc.structure;
  const th = calc.thermal;
  const b = p.building;
  const [showSpecParts, setShowSpecParts] = useState(false);
  const variants = useMemo(() => compareTech(p, settings, calc), [p, settings, calc]);
  const other = variants.find((v) => !v.selected);
  const current = variants.find((v) => v.selected);

  if (!st.ok) {
    return (
      <div className="page">
        <div className="notice bad">Расчёт каркаса не выполнен: {st.error}. Проверьте габариты и схему каркаса.</div>
      </div>
    );
  }

  const ld = st.loads;
  return (
    <div className="page stack">
      <div className="row no-print">
        <h2 className="grow" style={{ fontSize: 18 }}>
          Технические решения и расчётное обоснование
        </h2>
        {!SANDBOX ? (
          <button type="button" className="btn" onClick={() => window.print()}>
            Печать записки
          </button>
        ) : null}
      </div>

      <div className="notice info">
        Расчёт предварительный: подбор сечений по СП 16 на усилия из расчёта рамы методом конечных элементов. Он служит основанием для КП и задания на проектирование. До сверки с
        конструктором раздел КМ он не заменяет.
      </div>

      {calc.warnings.length ? (
        <div className="notice">
          <b>Требует внимания</b>
          <ul>
            {calc.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="cols-2">
        <section className="card">
          <div className="card-head">
            <h3>Конструктивная схема</h3>
          </div>
          <div className="card-body">
            <dl className="dl">
              <dt>Технология</dt>
              <dd>
                {TECH_LABEL[st.tech]} {st.techAuto ? <span className="pill blue">по правилам компании</span> : <span className="pill">выбрано вручную</span>}
              </dd>
              <dt>Покрытие</dt>
              <dd>
                {SCHEME_LABEL[st.scheme]}
                {st.scheme === 'truss' ? `, сопряжение с колоннами ${st.trussRigid ? 'жёсткое' : 'шарнирное'}` : ''}
              </dd>
              <dt>Пролёт и шаг рам</dt>
              <dd className="num">
                {b.spans > 1 ? `${b.spans} × ` : ''}
                {num(st.spanLen, 2)} м · шаг {num(st.step, 2)} м · {st.frames.length} {plural(st.frames.length, 'рама', 'рамы', 'рам')}
              </dd>
              <dt>Опирание колонн</dt>
              <dd>{st.baseFix === 'fixed' ? 'жёсткое защемление в фундаменте' : 'шарнирное'}</dd>
              <dt>Поперечная устойчивость</dt>
              <dd>{st.sideBraced ? 'связи по покрытию и в торцах' : 'поперечные рамы'}</dd>
              <dt>Продольная устойчивость</dt>
              <dd>вертикальные связи по колоннам и распорки</dd>
              <dt>Сталь, покрытие</dt>
              <dd>
                {p.frame.steel === 'C345' ? 'С345' : 'С255'}, {p.frame.coating === 'primer' ? 'грунт ГФ-021' : p.frame.coating === 'enamel' ? 'грунт-эмаль' : 'горячее цинкование'}
              </dd>
            </dl>
            {st.techReasons.map((r) => (
              <p key={r} className="muted small" style={{ margin: '10px 0 0' }}>
                {r}
              </p>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Нагрузки</h3>
            <span className="muted small">СП 20.13330.2016</span>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Нагрузка</th>
                  <th className="r">Нормативная</th>
                  <th className="r">Расчётная</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    Снег, район {ROMAN[p.site.snowDistrict]}, Sg = {num(ld.sg)} кПа, μ = {num(ld.mu)}
                  </td>
                  <td className="r">{nf(ld.snowN, 2)}</td>
                  <td className="r">{nf(ld.snow, 2)}</td>
                </tr>
                <tr>
                  <td>
                    Ветер, район {p.site.windDistrict}, тип местности {p.site.terrain}; w0 = {num(ld.w0)} кПа, k = {nf(ld.k, 2)}, ζ = {nf(ld.zeta, 2)}, ν = {nf(ld.nu, 2)}
                  </td>
                  <td className="r">{nf(ld.windN, 2)}</td>
                  <td className="r">{nf(ld.wind, 2)}</td>
                </tr>
                <tr>
                  <td>Покрытие: панели {nf(ld.roofPanel, 2)}, прогоны {nf(ld.purlins, 2)}, связи</td>
                  <td className="r">{nf(ld.roofDeadN, 2)}</td>
                  <td className="r">{nf(ld.roofDead, 2)}</td>
                </tr>
                <tr>
                  <td>Технологическая на покрытие (светильники, кабели)</td>
                  <td className="r">{nf(ld.tech, 2)}</td>
                  <td className="r">{nf(ld.tech * 1.2, 2)}</td>
                </tr>
                {ld.wall > 0 ? (
                  <tr>
                    <td>Стеновое ограждение</td>
                    <td className="r">{nf(ld.wall, 2)}</td>
                    <td className="r">{nf(ld.wall * 1.2, 2)}</td>
                  </tr>
                ) : null}
                {ld.floorDeadN > 0 ? (
                  <>
                    <tr>
                      <td>Перекрытие: постоянная</td>
                      <td className="r">{nf(ld.floorDeadN, 2)}</td>
                      <td className="r">{nf(ld.floorDeadN * 1.2, 2)}</td>
                    </tr>
                    <tr>
                      <td>Перекрытие: полезная</td>
                      <td className="r">{nf(ld.floorLiveN, 2)}</td>
                      <td className="r">{nf(ld.floorLiveN * (ld.floorLiveN < 2 ? 1.3 : 1.2), 2)}</td>
                    </tr>
                  </>
                ) : null}
                {ld.crane ? (
                  <tr>
                    <td>
                      Кран {num(p.frame.crane.capacity)} т: давление на колонну (точку подвеса) наибольшее / наименьшее, кН
                    </td>
                    <td className="r">—</td>
                    <td className="r">
                      {nf(ld.crane.dMax, 0)} / {nf(ld.crane.dMin, 0)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="card-body muted small">
            Нагрузки на покрытие и стены — в кПа (1 кПа ≈ 100 кг/м²). Загружений: {st.cases.length}, сочетаний: {st.comboCount}.
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Основные элементы рамы</h3>
          <span className="muted small">усилия — из определяющего сочетания</span>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Элемент</th>
                <th>Сечение</th>
                <th>Использование</th>
                <th>Определяющая проверка</th>
                <th>Сочетание</th>
                <th className="r">N, кН</th>
                <th className="r">M, кН·м</th>
                <th className="r">Расч. длины, м</th>
                <th className="r">Гибкость</th>
              </tr>
            </thead>
            <tbody>
              {st.groups.map((g) => (
                <tr key={g.key}>
                  <td>{g.label}</td>
                  <td>
                    <b>{g.section}</b>
                  </td>
                  <td>
                    <Util value={g.util} />
                  </td>
                  <td>{g.governing}</td>
                  <td className="num small">{g.combo}</td>
                  <td className="r">{nf(g.N, 0)}</td>
                  <td className="r">{nf(g.M, 1)}</td>
                  <td className="r">
                    {nf(g.lefIn, 1)} / {nf(g.lefOut, 1)}
                  </td>
                  <td className="r">
                    {nf(g.lambdaX, 0)} / {nf(g.lambdaY, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="cols-2">
        <section className="card">
          <div className="card-head">
            <h3>Второстепенные элементы</h3>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Марка</th>
                  <th>Элемент</th>
                  <th>Сечение</th>
                  <th>Использование</th>
                  <th className="r">Кол-во</th>
                </tr>
              </thead>
              <tbody>
                {st.secondary.map((s) => (
                  <tr key={s.key}>
                    <td className="num">{s.mark}</td>
                    <td>
                      {s.label}
                      <div className="muted small">{s.basis}</div>
                    </td>
                    <td>
                      <b>{s.section}</b>
                    </td>
                    <td>
                      <Util value={s.util} />
                    </td>
                    <td className="r">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h3>Жёсткость</h3>
              {st.sls.ok ? <span className="pill ok">в пределах нормы</span> : <span className="pill bad">превышение</span>}
            </div>
            <div className="card-body">
              <dl className="dl">
                <dt>Прогиб покрытия</dt>
                <dd className="num">
                  {nf(st.sls.deflection * 1000, 0)} мм при допустимых {nf(st.sls.deflectionLimit * 1000, 0)} мм
                </dd>
                <dt>Смещение верха колонн</dt>
                <dd className="num">
                  {nf(st.sls.drift * 1000, 0)} мм при допустимых {nf(st.sls.driftLimit * 1000, 0)} мм
                </dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Теплозащита</h3>
              <span className="muted small">СП 50.13330.2012</span>
            </div>
            {th.heated ? (
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>Конструкция</th>
                      <th className="r">R треб.</th>
                      <th className="r">R факт.</th>
                      <th>Оценка</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        Стены {p.envelope.walls === 'sandwich' ? `${p.envelope.wallThk} мм, ${CORE_LABEL[p.envelope.wallCore]}` : 'без утепления'}
                      </td>
                      <td className="r">{nf(th.wall.rReq, 2)}</td>
                      <td className="r">{th.wall.status === 'na' ? '—' : nf(th.wall.rFact, 2)}</td>
                      <td>
                        <Status s={th.wall.status} />
                      </td>
                    </tr>
                    <tr>
                      <td>
                        Кровля {p.envelope.roofing === 'sandwich' ? `${p.envelope.roofThk} мм, ${CORE_LABEL[p.envelope.roofCore]}` : 'без утепления'}
                      </td>
                      <td className="r">{nf(th.roof.rReq, 2)}</td>
                      <td className="r">{th.roof.status === 'na' ? '—' : nf(th.roof.rFact, 2)}</td>
                      <td>
                        <Status s={th.roof.status} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="card-body muted small">
              {th.heated
                ? `Градусо-сутки отопительного периода: ${nf(th.gsop, 0)} при ${num(b.tInside)} °C внутри. R — сопротивление теплопередаче, м²·°C/Вт.`
                : 'Здание неотапливаемое: теплозащита не нормируется, толщина панелей выбирается из конструктивных соображений.'}
            </div>
          </section>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Фундаменты: {calc.foundation.title.toLowerCase()}</h3>
          <span className="muted small">
            R0 = {num(p.site.soilR0)} кПа, промерзание {num(p.site.frostDepth)} м
          </span>
        </div>
        <div className="card-body">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {calc.foundation.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Нагрузки на фундаменты (расчётные)</th>
                <th className="r">Кол-во</th>
                <th className="r">N max, кН</th>
                <th className="r">N min, кН</th>
                <th className="r">M max, кН·м</th>
                <th className="r">Q max, кН</th>
                <th>Сочетание для M</th>
              </tr>
            </thead>
            <tbody>
              {st.foundationLoads.map((f) => (
                <tr key={f.cls}>
                  <td>{f.label}</td>
                  <td className="r">{f.count}</td>
                  <td className="r">{nf(f.nMax, 0)}</td>
                  <td className="r">{nf(f.nMin, 0)}</td>
                  <td className="r">{nf(f.mMax, 0)}</td>
                  <td className="r">{nf(f.qMax, 0)}</td>
                  <td className="num small">{f.comboM || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body muted small">
          Отрицательное значение N min означает отрыв. Колонны связевых блоков дополнительно получают от продольных связей: горизонтальную силу {nf(st.braceReaction.horizontal, 0)} кН и вертикальную ±
          {nf(st.braceReaction.vertical, 0)} кН. Эта таблица — задание на фундаменты, если их выполняет заказчик.
        </div>
      </section>

      {other && current ? (
        <section className="card no-print">
          <div className="card-head">
            <h3>Сравнение технологий каркаса</h3>
            <span className="muted small">то же здание, оба варианта</span>
          </div>
          <div className="card-body cols-2">
            {variants.map((v) => (
              <div key={v.tech} className="variant" data-selected={v.selected}>
                <h4>
                  {TECH_LABEL[v.tech]} {v.selected ? <span className="pill blue">в расчёте</span> : null} {!v.ok ? <span className="pill warn">не проходит по сортаменту</span> : null}
                </h4>
                <dl className="dl">
                  <dt>Масса каркаса</dt>
                  <dd className="num">
                    {nf(v.mass / 1000, 2)} т · {nf(v.kgPerM2, 1)} кг/м²
                  </dd>
                  <dt>Каркас с проектированием</dt>
                  <dd className="num">{rub(v.frameCost)}</dd>
                  <dt>Итого по объекту</dt>
                  <dd className="num">{rub(v.total)}</dd>
                  <dt>Срок</dt>
                  <dd className="num">
                    {v.weeks} {plural(v.weeks, 'неделя', 'недели', 'недель')}
                  </dd>
                </dl>
                {!v.selected ? (
                  <div className="row" style={{ marginTop: 10 }}>
                    <button type="button" className="btn sm" onClick={() => patch((d) => void (d.frame.tech = v.tech))}>
                      Принять этот вариант
                    </button>
                    <span className="muted small">
                      {v.total < current.total ? `дешевле на ${rub(current.total - v.total)}` : `дороже на ${rub(v.total - current.total)}`}
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h3>Ведомость элементов каркаса</h3>
          <span className="row">
            <span className="num">
              {nf(st.mass.total / 1000, 2)} т · {nf(st.mass.kgPerM2, 1)} кг/м²
            </span>
            {st.spec.some((r) => r.parts) ? (
              <button type="button" className="btn sm no-print" onClick={() => setShowSpecParts((v) => !v)}>
                {showSpecParts ? 'Скрыть состав ферм' : 'Показать состав ферм'}
              </button>
            ) : null}
          </span>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Марка</th>
                <th>Наименование</th>
                <th>Сечение</th>
                <th className="r">Длина, м</th>
                <th className="r">Кол-во</th>
                <th className="r">Масса ед., кг</th>
                <th className="r">Масса общая, кг</th>
              </tr>
            </thead>
            <tbody>
              {st.spec.map((r, i) => (
                <Fragment key={`${r.mark}-${i}`}>
                  <tr>
                    <td className="num">{r.mark}</td>
                    <td>
                      {r.name}
                      {r.note ? <div className="muted small">{r.note}</div> : null}
                    </td>
                    <td>{r.section}</td>
                    <td className="r">{r.length ? nf(r.length, 2) : '—'}</td>
                    <td className="r">{r.family === 'plate' ? '—' : r.count}</td>
                    <td className="r">{r.family === 'plate' ? '—' : nf(r.massEach, 1)}</td>
                    <td className="r">{nf(r.massTotal, 0)}</td>
                  </tr>
                  {showSpecParts && r.parts
                    ? r.parts.map((q) => (
                        <tr key={q.name} className="sub">
                          <td />
                          <td>— {q.name.toLowerCase()}</td>
                          <td>{q.section}</td>
                          <td className="r">{nf(q.length, 2)}</td>
                          <td className="r" />
                          <td className="r">{nf(q.mass, 1)}</td>
                          <td className="r" />
                        </tr>
                      ))
                    : null}
                </Fragment>
              ))}
              <tr className="total">
                <td colSpan={6}>Всего</td>
                <td className="r">{nf(st.mass.total, 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card-body muted small">
          По видам проката: труба {nf(st.mass.tube / 1000, 2)} т, двутавр {nf(st.mass.ibeam / 1000, 2)} т, швеллер {nf(st.mass.channel / 1000, 2)} т, лист {nf(st.mass.plate / 1000, 2)} т.
          {st.mass.truss > 0 ? ` Фермы заводской сварки: ${nf(st.mass.truss / 1000, 2)} т.` : ''}
        </div>
      </section>

      <div className="cols-2">
        <section className="card">
          <div className="card-head">
            <h3>Ограждающие конструкции</h3>
          </div>
          <div className="card-body">
            <dl className="dl">
              <dt>Стены</dt>
              <dd>
                {p.envelope.walls === 'none'
                  ? 'нет (навес)'
                  : p.envelope.walls === 'sandwich'
                    ? `сэндвич-панели ${p.envelope.wallThk} мм, ${CORE_LABEL[p.envelope.wallCore]}, раскладка ${p.envelope.wallLayout === 'horizontal' ? 'горизонтальная' : 'вертикальная'}`
                    : 'профлист по ригелям'}
              </dd>
              {p.envelope.walls !== 'none' ? (
                <>
                  <dt>Площадь стен</dt>
                  <dd className="num">
                    {nf(calc.geo.wallNet, 0)} м² за вычетом проёмов {nf(calc.geo.openingsArea, 0)} м²
                  </dd>
                  <dt>Цвет стен</dt>
                  <dd>{ralLabel(p.envelope.wallColor)}</dd>
                </>
              ) : null}
              <dt>Кровля</dt>
              <dd>{p.envelope.roofing === 'sandwich' ? `сэндвич-панели ${p.envelope.roofThk} мм, ${CORE_LABEL[p.envelope.roofCore]}` : 'профлист по прогонам'}</dd>
              <dt>Площадь кровли</dt>
              <dd className="num">
                {nf(calc.geo.roofArea, 0)} м², уклон {num(b.slopeDeg)}°
              </dd>
              <dt>Цвет кровли</dt>
              <dd>{ralLabel(p.envelope.roofColor)}</dd>
              <dt>Фасонные элементы</dt>
              <dd className="num">{nf(calc.geo.trim.total, 0)} м.п.</dd>
              <dt>Высота стены / конька</dt>
              <dd className="num">
                {nf(calc.geo.eaveHeight, 2)} / {nf(calc.geo.ridgeHeight, 2)} м
              </dd>
            </dl>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>График работ</h3>
            <span className="num">
              {calc.schedule.weeks} {plural(calc.schedule.weeks, 'неделя', 'недели', 'недель')}
            </span>
          </div>
          <div className="card-body">
            <Gantt />
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              Длительности в рабочих днях, укрупнённо. Проектирование, изготовление каркаса и фундаменты идут частично параллельно.
            </p>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Допущения расчёта</h3>
        </div>
        <div className="card-body">
          <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
            {st.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
