import { useState } from 'react';
import { ralLabel } from './domain/colors';
import { PRESETS } from './domain/presets';
import { vatLabel } from './domain/settings';
import { CORE_LABEL } from './domain/thermal';
import { useApp } from './state/store';
import { DrawingsView } from './ui/DrawingsView';
import { EstimateView } from './ui/EstimateView';
import { SANDBOX, downloadJson, safeFileName } from './ui/files';
import { TECH_LABEL, nf, num, plural, rub, rubShort } from './ui/format';
import { ParamsPanel } from './ui/ParamsPanel';
import { PricesView } from './ui/PricesView';
import { ProjectsView } from './ui/ProjectsView';
import { ProposalView } from './ui/ProposalView';
import { TechView } from './ui/TechView';
import { Viewer3D } from './ui/Viewer3D';

type Tab = 'calc' | 'tech' | 'drawings' | 'estimate' | 'kp' | 'prices' | 'projects';

const TABS: { id: Tab; label: string }[] = [
  { id: 'calc', label: 'Здание' },
  { id: 'tech', label: 'Решения и расчёт' },
  { id: 'drawings', label: 'Чертежи' },
  { id: 'estimate', label: 'Смета' },
  { id: 'kp', label: 'КП' },
  { id: 'prices', label: 'Цены' },
  { id: 'projects', label: 'Расчёты' },
];

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 30 30" aria-hidden="true">
      <rect x="0" y="0" width="30" height="30" rx="6" fill="var(--accent)" />
      <path d="M6 23V13L15 7l9 6v10" fill="none" stroke="var(--accent-ink)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M6 13h18M10.5 13l4.5-3 4.5 3" fill="none" stroke="var(--accent-ink)" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function Summary() {
  const { project: p, calc } = useApp();
  const st = calc.structure;
  const t = calc.estimate.totals;
  const b = p.building;
  return (
    <div className="summary">
      <div className="summary-inner">
        <div className="kpi">
          <div className="kpi-label">Площадь</div>
          <div className="kpi-value">{nf(calc.totals.totalFloorArea, 0)} м²</div>
          <div className="kpi-sub">
            {num(b.width)}×{num(b.length)}×{num(b.height)} м{calc.blocks.length > 1 ? ` + ${calc.blocks.length - 1} ${plural(calc.blocks.length - 1, 'пристройка', 'пристройки', 'пристроек')}` : ''}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Каркас</div>
          <div className="kpi-value">{nf(calc.totals.mass / 1000, 1)} т</div>
          <div className="kpi-sub">
            {nf(calc.totals.kgPerM2, 1)} кг/м² · {st.tech === 'welded' ? 'сварной' : 'КМ/КМД'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Срок</div>
          <div className="kpi-value">
            {calc.schedule.weeks} {plural(calc.schedule.weeks, 'неделя', 'недели', 'недель')}
          </div>
          <div className="kpi-sub">от аванса до сдачи</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Себестоимость</div>
          <div className="kpi-value">{rubShort(t.cost)}</div>
          <div className="kpi-sub">
            маржа {nf(t.marginPct, 1)}% · {rubShort(t.margin)}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">За м²</div>
          <div className="kpi-value">{rub(t.perM2)}</div>
          <div className="kpi-sub">общей площади</div>
        </div>
        <div className="kpi total">
          <div className="kpi-label">Итого клиенту</div>
          <div className="kpi-value">{rub(t.total)}</div>
          <div className="kpi-sub">{vatLabel(calc.entity)}</div>
        </div>
      </div>
    </div>
  );
}

function BuildingTab({ go }: { go(tab: Tab): void }) {
  const { project: p, calc, moveOpening } = useApp();
  const st = calc.structure;
  const env = p.envelope;
  const col = st.groups.find((g) => g.key === 'colOuter');
  const roof = st.groups.find((g) => g.key === 'rafter') ?? st.groups.find((g) => g.key === 'topChord');
  return (
    <div className="workspace">
      <ParamsPanel />
      <div className="stack sticky result-col">
        <Viewer3D project={p} calc={calc} onMoveOpening={moveOpening} />
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
        <section className="card">
          <div className="card-head">
            <h3>Подобранные решения</h3>
            <button type="button" className="btn sm" onClick={() => go('tech')}>
              Расчёт и обоснование
            </button>
          </div>
          <div className="card-body">
            <dl className="dl">
              <dt>Каркас</dt>
              <dd>
                {TECH_LABEL[st.tech]}, {st.scheme === 'truss' ? 'фермы' : 'рамы с ригелем'}, шаг {num(st.step, 2)} м
              </dd>
              <dt>Колонны</dt>
              <dd>{col?.section ?? '—'}</dd>
              <dt>{st.scheme === 'truss' ? 'Пояса ферм' : 'Ригели'}</dt>
              <dd>
                {roof?.section ?? '—'}
                {st.scheme === 'truss' ? ` / ${st.groups.find((g) => g.key === 'botChord')?.section.replace('Труба ', '') ?? ''}` : ''}
              </dd>
              <dt>Прогоны</dt>
              <dd>{st.secondary.find((s) => s.key === 'purlin')?.section ?? '—'}</dd>
              <dt>Стены</dt>
              <dd>
                {env.walls === 'none' ? 'нет' : env.walls === 'sandwich' ? `сэндвич ${env.wallThk} мм, ${CORE_LABEL[env.wallCore]}, ${ralLabel(env.wallColor)}` : 'профлист'}
              </dd>
              <dt>Кровля</dt>
              <dd>{env.roofing === 'sandwich' ? `сэндвич ${env.roofThk} мм, ${CORE_LABEL[env.roofCore]}, ${ralLabel(env.roofColor)}` : 'профлист'}</dd>
              <dt>Фундамент</dt>
              <dd>{calc.foundation.title}</dd>
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}

export function App() {
  const { project: p, patch } = useApp();
  const [tab, setTab] = useState<Tab>('calc');
  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <BrandMark />
            <span>
              Строим для Вас
              <small>расчётный модуль</small>
            </span>
          </div>
          <input
            id="project-title"
            className="title-input"
            aria-label="Название расчёта"
            value={p.name}
            placeholder={`Название расчёта: например, ${PRESETS[p.building.type].label.toLowerCase()} для ООО «Клиент»`}
            onChange={(e) => patch((d) => void (d.name = e.target.value))}
          />
          <div className="topbar-actions">
            <button type="button" className="btn" onClick={() => go('projects')}>
              Новый расчёт
            </button>
            {!SANDBOX ? (
              <button type="button" className="btn" onClick={() => downloadJson(`${safeFileName(`КП ${p.number} ${p.name}`)}.json`, p)}>
                Сохранить в файл
              </button>
            ) : null}
          </div>
        </div>
        <nav className="tabs" role="tablist" aria-label="Разделы">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <Summary />
      <main className="main">
        {tab === 'calc' ? <BuildingTab go={go} /> : null}
        {tab === 'tech' ? <TechView /> : null}
        {tab === 'drawings' ? <DrawingsView /> : null}
        {tab === 'estimate' ? <EstimateView /> : null}
        {tab === 'kp' ? <ProposalView /> : null}
        {tab === 'prices' ? <PricesView /> : null}
        {tab === 'projects' ? <ProjectsView onOpen={() => go('calc')} /> : null}
      </main>
    </div>
  );
}
