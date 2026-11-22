// Форма исходных данных: запрос клиента и принятые решения.

import { useState } from 'react';
import { REGIONS, SETTLEMENTS, settlementById } from '../domain/climate';
import { RAL, ralLabel } from '../domain/colors';
import { FOUNDATION_LABEL } from '../domain/foundation';
import { ROMAN, SNOW_DISTRICTS, SNOW_SG, WIND_DISTRICTS, WIND_W0 } from '../domain/loads';
import { BUILDING_TYPES, PRESETS, applyPreset, siteFromSettlement, uid } from '../domain/presets';
import { vatLabel } from '../domain/settings';
import { CORE_LABEL, PANEL_THICKNESS } from '../domain/thermal';
import type { BuildingType, CoreType, FoundationType, Opening, OpeningKind, Project, WallSide } from '../domain/types';
import { useApp } from '../state/store';
import { Acc, Check, Field, Num, Seg, Select, Text } from './fields';
import { TECH_LABEL, num } from './format';

const CORE_OPTIONS = (Object.keys(CORE_LABEL) as CoreType[]).map((c) => ({ value: c, label: CORE_LABEL[c][0].toUpperCase() + CORE_LABEL[c].slice(1) }));
const THK_OPTIONS = PANEL_THICKNESS.map((t) => ({ value: t, label: `${t} мм` }));

const WALLS: { value: WallSide; label: string }[] = [
  { value: 'front', label: 'Торец по оси 1' },
  { value: 'back', label: 'Торец противоположный' },
  { value: 'left', label: 'Продольная стена по оси А' },
  { value: 'right', label: 'Продольная стена противоположная' },
];

const SUBTYPES: Record<OpeningKind, { value: string; label: string }[]> = {
  gate: [
    { value: 'sectional', label: 'Секционные подъёмные' },
    { value: 'swing', label: 'Распашные утеплённые' },
    { value: 'roller', label: 'Рулонные' },
  ],
  door: [
    { value: 'steel', label: 'Металлическая утеплённая' },
    { value: 'alu', label: 'Алюминиевая остеклённая' },
    { value: 'fire', label: 'Противопожарная EI60' },
  ],
  window: [
    { value: 'pvc', label: 'Окно ПВХ' },
    { value: 'vitrage', label: 'Витраж алюминиевый' },
  ],
};

const KIND_LABEL: Record<OpeningKind, string> = { gate: 'Ворота', door: 'Дверь', window: 'Окно' };

const NEW_OPENING: Record<OpeningKind, Omit<Opening, 'id'>> = {
  gate: { kind: 'gate', subtype: 'sectional', wall: 'front', w: 4, h: 4, qty: 1, sill: 0, offset: null, automation: true },
  door: { kind: 'door', subtype: 'steel', wall: 'left', w: 0.9, h: 2.05, qty: 1, sill: 0, offset: null },
  window: { kind: 'window', subtype: 'pvc', wall: 'left', w: 1.5, h: 1.2, qty: 2, sill: 1, offset: null },
};

function Swatches({ value, onChange, label }: { value: string; onChange(v: string): void; label: string }) {
  return (
    <div className="field wide">
      <span>
        {label}: <b>{ralLabel(value)}</b>
      </span>
      <div className="swatches" role="group" aria-label={label}>
        {RAL.map((c) => (
          <button
            key={c.id}
            type="button"
            className="swatch"
            style={{ background: c.hex }}
            aria-pressed={c.id === value}
            aria-label={`RAL ${c.id} ${c.name}`}
            title={`RAL ${c.id} ${c.name}`}
            onClick={() => onChange(c.id)}
          />
        ))}
      </div>
    </div>
  );
}

function OpeningEditor({ o, wallHeight }: { o: Opening; wallHeight: number }) {
  const { patch } = useApp();
  const edit = (fn: (x: Opening) => void) =>
    patch((d) => {
      const x = d.openings.find((q) => q.id === o.id);
      if (x) fn(x);
    });
  const tooTall = o.sill + o.h > wallHeight + 0.01 && (o.wall === 'left' || o.wall === 'right');
  return (
    <div className="opening">
      <div className="opening-head">
        <b>
          {KIND_LABEL[o.kind]} {num(o.w)}×{num(o.h)} м{o.qty > 1 ? `, ${o.qty} шт.` : ''}
        </b>
        <button type="button" className="btn sm ghost danger" onClick={() => patch((d) => void (d.openings = d.openings.filter((q) => q.id !== o.id)))}>
          Убрать
        </button>
      </div>
      <div className="fields">
        <Field label="Тип">
          <Select value={o.subtype} options={SUBTYPES[o.kind]} onChange={(v) => edit((x) => void (x.subtype = v))} />
        </Field>
        <Field label="Стена">
          <Select value={o.wall} options={WALLS} onChange={(v) => edit((x) => void (x.wall = v))} />
        </Field>
      </div>
      <div className="fields four" style={{ marginTop: 10 }}>
        <Field label="Ширина">
          <Num value={o.w} min={0.4} max={30} unit="м" onChange={(v) => edit((x) => void (x.w = v))} />
        </Field>
        <Field label="Высота">
          <Num value={o.h} min={0.4} max={15} unit="м" onChange={(v) => edit((x) => void (x.h = v))} />
        </Field>
        <Field label="Количество">
          <Num value={o.qty} min={1} max={60} unit="шт" onChange={(v) => edit((x) => void (x.qty = Math.round(v)))} />
        </Field>
        {o.kind === 'window' ? (
          <Field label="Низ от пола">
            <Num value={o.sill} min={0} max={20} unit="м" onChange={(v) => edit((x) => void (x.sill = v))} />
          </Field>
        ) : (
          <Field label="Привязка">
            <Num value={o.offset} min={0} max={200} unit="м" placeholder="авто" onChange={(v) => edit((x) => void (x.offset = v))} onClear={() => edit((x) => void (x.offset = null))} />
          </Field>
        )}
      </div>
      {o.kind === 'window' ? (
        <div className="fields" style={{ marginTop: 10 }}>
          <Field label="Привязка от начала стены" hint="Пусто — расставить равномерно">
            <Num value={o.offset} min={0} max={200} unit="м" placeholder="авто" onChange={(v) => edit((x) => void (x.offset = v))} onClear={() => edit((x) => void (x.offset = null))} />
          </Field>
        </div>
      ) : null}
      {o.kind === 'gate' ? (
        <Check checked={!!o.automation} onChange={(v) => edit((x) => void (x.automation = v))}>
          Электропривод с автоматикой
        </Check>
      ) : null}
      {tooTall ? <div className="notice bad small" style={{ marginTop: 8 }}>Проём выше стены ({num(wallHeight, 1)} м).</div> : null}
    </div>
  );
}

export function ParamsPanel() {
  const { project: p, patch, replace, calc, settings } = useApp();
  const [open, setOpen] = useState<Record<string, boolean>>({ object: true, dims: true });
  const toggle = (id: string) => setOpen((s) => ({ ...s, [id]: !s[id] }));
  const b = p.building;
  const st = calc.structure;
  const th = calc.thermal;
  const settlement = settlementById(p.site.settlementId);
  const canopy = p.envelope.walls === 'none';
  const entity = calc.entity;

  const setType = (type: BuildingType) =>
    replace({ ...applyPreset(p, type), name: p.name.startsWith('Пример:') ? '' : p.name, updatedAt: new Date().toISOString() });

  const applyRecommended = () =>
    patch((d) => {
      d.envelope.wallThk = th.wall.recommended;
      d.envelope.roofThk = th.roof.recommended;
    });

  const openingCount = p.openings.reduce((s, o) => s + o.qty, 0);
  const techNote = st.techReasons.join(' ');

  return (
    <div>
      <Acc title="Объект и клиент" summary={`${PRESETS[b.type].label}${p.client.name ? ` · ${p.client.name}` : ''}`} open={!!open.object} onToggle={() => toggle('object')}>
        <div>
          <div className="field-label" style={{ marginBottom: 6 }}>
            Тип здания — шаблон задаёт типовые габариты, проёмы и фундамент
          </div>
          <div className="type-grid">
            {BUILDING_TYPES.map((t) => (
              <button key={t} type="button" className="type-btn" aria-pressed={t === b.type} onClick={() => setType(t)}>
                <b>{PRESETS[t].label}</b>
                <span>{PRESETS[t].hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="fields">
          <Field label="Клиент" wide>
            <Text value={p.client.name} placeholder="Организация или ФИО" onChange={(v) => patch((d) => void (d.client.name = v))} />
          </Field>
          <Field label="Контактное лицо">
            <Text value={p.client.contact} onChange={(v) => patch((d) => void (d.client.contact = v))} />
          </Field>
          <Field label="Телефон">
            <Text type="tel" value={p.client.phone} onChange={(v) => patch((d) => void (d.client.phone = v))} />
          </Field>
          <Field label="Email" wide>
            <Text type="email" value={p.client.email} onChange={(v) => patch((d) => void (d.client.email = v))} />
          </Field>
        </div>
      </Acc>

      <Acc
        title="Площадка"
        summary={`${settlement?.name ?? 'Вручную'} · снег ${ROMAN[p.site.snowDistrict]}, ветер ${p.site.windDistrict}`}
        open={!!open.site}
        onToggle={() => toggle('site')}
      >
        <div className="fields">
          <Field label="Населённый пункт" wide hint="Подставляет снеговой и ветровой районы, отопительный период и глубину промерзания. Любое значение можно поправить ниже.">
            <select
              value={p.site.settlementId}
              onChange={(e) => {
                const s = settlementById(e.target.value);
                if (s) patch((d) => void (d.site = siteFromSettlement(s, d.site)));
              }}
            >
              {!settlement ? <option value={p.site.settlementId}>Задано вручную</option> : null}
              {REGIONS.map((r) => {
                const list = SETTLEMENTS.filter((s) => s.region === r);
                if (!list.length) return null;
                return (
                  <optgroup key={r} label={r}>
                    {list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </Field>
          <Field label="Адрес объекта" wide>
            <Text value={p.site.address} placeholder="Район, населённый пункт, участок" onChange={(v) => patch((d) => void (d.site.address = v))} />
          </Field>
          <Field label="Снеговой район">
            <Select
              value={p.site.snowDistrict}
              options={SNOW_DISTRICTS.map((n) => ({ value: n, label: `${ROMAN[n]} — ${num(SNOW_SG[n])} кПа` }))}
              onChange={(v) =>
                patch((d) => {
                  d.site.snowDistrict = v;
                  d.site.sg = SNOW_SG[v];
                })
              }
            />
          </Field>
          <Field label="Вес снега Sg">
            <Num value={p.site.sg} min={0.1} max={8} unit="кПа" onChange={(v) => patch((d) => void (d.site.sg = v))} />
          </Field>
          <Field label="Ветровой район">
            <Select
              value={p.site.windDistrict}
              options={WIND_DISTRICTS.map((w) => ({ value: w, label: `${w} — ${num(WIND_W0[w])} кПа` }))}
              onChange={(v) => patch((d) => void (d.site.windDistrict = v))}
            />
          </Field>
          <Field label="Тип местности">
            <Select
              value={p.site.terrain}
              options={[
                { value: 'A', label: 'A — открытая: поле, берег' },
                { value: 'B', label: 'B — застройка, лес до 25 м' },
                { value: 'C', label: 'C — плотная городская' },
              ]}
              onChange={(v) => patch((d) => void (d.site.terrain = v))}
            />
          </Field>
          <Field label="Глубина промерзания">
            <Num value={p.site.frostDepth} min={0.3} max={4} unit="м" onChange={(v) => patch((d) => void (d.site.frostDepth = v))} />
          </Field>
          <Field label="Сопротивление грунта R0" hint="Без изысканий принимают 150–250 кПа">
            <Num value={p.site.soilR0} min={80} max={600} unit="кПа" onChange={(v) => patch((d) => void (d.site.soilR0 = v))} />
          </Field>
          <Field label="Отопительный период: температура">
            <Num value={p.site.tHeat} min={-30} max={10} unit="°C" onChange={(v) => patch((d) => void (d.site.tHeat = v))} />
          </Field>
          <Field label="Отопительный период: длительность">
            <Num value={p.site.zHeat} min={30} max={365} unit="сут" onChange={(v) => patch((d) => void (d.site.zHeat = Math.round(v)))} />
          </Field>
          <Field label="Расстояние доставки" wide>
            <Num value={p.site.deliveryKm} min={0} max={3000} unit="км" onChange={(v) => patch((d) => void (d.site.deliveryKm = v))} />
          </Field>
        </div>
        {settlement?.check ? <div className="notice small">Районы для этого пункта взяты по картам СП 20 и требуют проверки по месту.</div> : null}
      </Acc>

      <Acc
        title="Габариты"
        summary={`${num(b.width)}×${num(b.length)}×${num(b.height)} м · ${b.roof === 'gable' ? 'двускатная' : 'односкатная'}`}
        open={!!open.dims}
        onToggle={() => toggle('dims')}
      >
        <div className="fields">
          <Field label="Ширина по осям">
            <Num value={b.width} min={2} max={120} unit="м" onChange={(v) => patch((d) => void (d.building.width = v))} />
          </Field>
          <Field label="Длина по осям">
            <Num value={b.length} min={2} max={300} unit="м" onChange={(v) => patch((d) => void (d.building.length = v))} />
          </Field>
          <Field label="Высота до низа конструкций" hint="Полезная высота под фермой или балкой">
            <Num value={b.height} min={2} max={24} unit="м" onChange={(v) => patch((d) => void (d.building.height = v))} />
          </Field>
          <Field label="Пролётов поперёк" hint={`Пролёт ${num(b.width / b.spans, 2)} м`}>
            <Seg
              value={b.spans}
              label="Число пролётов"
              options={[
                { value: 1, label: '1' },
                { value: 2, label: '2' },
                { value: 3, label: '3' },
              ]}
              onChange={(v) => patch((d) => void (d.building.spans = v))}
            />
          </Field>
          <Field label="Кровля">
            <Seg
              value={b.roof}
              label="Форма кровли"
              options={[
                { value: 'gable', label: 'Двускатная' },
                { value: 'mono', label: 'Односкатная' },
              ]}
              onChange={(v) => patch((d) => void (d.building.roof = v))}
            />
          </Field>
          <Field label="Уклон кровли" hint={`${num(Math.tan((b.slopeDeg * Math.PI) / 180) * 100, 0)}%`}>
            <Num value={b.slopeDeg} min={3} max={45} unit="°" onChange={(v) => patch((d) => void (d.building.slopeDeg = v))} />
          </Field>
          <Field label="Этажей">
            <Seg
              value={b.floors}
              label="Число этажей"
              options={[
                { value: 1, label: '1' },
                { value: 2, label: '2' },
                { value: 3, label: '3' },
              ]}
              onChange={(v) => patch((d) => void (d.building.floors = v))}
            />
          </Field>
          {b.floors > 1 ? (
            <>
              <Field label="Длина зоны перекрытий" hint="Пусто — на всю длину. Меньше длины — антресоль от оси 1.">
                <Num
                  value={b.floorLength}
                  min={2}
                  max={b.length}
                  unit="м"
                  placeholder="вся длина"
                  onChange={(v) => patch((d) => void (d.building.floorLength = v))}
                  onClear={() => patch((d) => void (d.building.floorLength = null))}
                />
              </Field>
              <Field label="Полезная нагрузка на перекрытие" wide hint="Офисы 200, торговые залы 400, склады от 500 кг/м²">
                <Num value={Math.round(b.floorLiveKpa * 100)} min={100} max={2000} unit="кг/м²" onChange={(v) => patch((d) => void (d.building.floorLiveKpa = v / 100))} />
              </Field>
            </>
          ) : null}
          <Field label="Отопление">
            <Check checked={b.heated} onChange={(v) => patch((d) => void (d.building.heated = v))}>
              Здание отапливается
            </Check>
          </Field>
          {b.heated ? (
            <Field label="Температура внутри">
              <Num value={b.tInside} min={5} max={28} unit="°C" onChange={(v) => patch((d) => void (d.building.tInside = v))} />
            </Field>
          ) : null}
        </div>
      </Acc>

      <Acc title="Каркас" summary={`${TECH_LABEL[st.tech]}${st.techAuto ? ' (авто)' : ''} · шаг ${num(st.step, 2)} м`} open={!!open.frame} onToggle={() => toggle('frame')}>
        <div className="fields">
          <Field label="Технология" wide hint={techNote || undefined}>
            <Seg
              value={p.frame.tech}
              label="Технология каркаса"
              options={[
                { value: 'auto', label: 'По правилам компании' },
                { value: 'welded', label: 'Сварной' },
                { value: 'kmd', label: 'КМ/КМД' },
              ]}
              onChange={(v) => patch((d) => void (d.frame.tech = v))}
            />
          </Field>
          <Field label="Шаг рам" hint={`Принят ${num(st.step, 2)} м, рам: ${st.frames.length}`}>
            <Num
              value={p.frame.step}
              min={1.5}
              max={12}
              unit="м"
              placeholder="авто"
              onChange={(v) => patch((d) => void (d.frame.step = v))}
              onClear={() => patch((d) => void (d.frame.step = null))}
            />
          </Field>
          <Field label="Несущие конструкции покрытия" hint={p.frame.roofScheme === 'auto' ? `Принято: ${st.scheme === 'truss' ? 'фермы' : 'балки'}` : undefined}>
            <Select
              value={p.frame.roofScheme}
              options={[
                { value: 'auto', label: 'Авто' },
                { value: 'beam', label: 'Балки (ригели рам)' },
                { value: 'truss', label: 'Фермы' },
              ]}
              onChange={(v) => patch((d) => void (d.frame.roofScheme = v))}
            />
          </Field>
          <Field label="Опирание колонн" hint={`Принято: ${st.baseFix === 'fixed' ? 'жёсткое' : 'шарнирное'}`}>
            <Select
              value={p.frame.base}
              options={[
                { value: 'auto', label: 'Авто' },
                { value: 'fixed', label: 'Жёсткое защемление' },
                { value: 'pinned', label: 'Шарнирное' },
              ]}
              onChange={(v) => patch((d) => void (d.frame.base = v))}
            />
          </Field>
          <Field label="Сопряжение ферм с колоннами">
            <Select
              value={p.frame.trussJoint}
              options={[
                { value: 'auto', label: 'Авто' },
                { value: 'rigid', label: 'Жёсткое' },
                { value: 'hinged', label: 'Шарнирное' },
              ]}
              onChange={(v) => patch((d) => void (d.frame.trussJoint = v))}
            />
          </Field>
          <Field label="Профиль колонн">
            <Select
              value={p.frame.columnProfile}
              options={[
                { value: 'auto', label: 'Авто' },
                { value: 'tube', label: 'Профильная труба' },
                { value: 'ibeam', label: 'Двутавр' },
              ]}
              onChange={(v) => patch((d) => void (d.frame.columnProfile = v))}
            />
          </Field>
          <Field label="Сталь">
            <Select
              value={p.frame.steel}
              options={[
                { value: 'C255', label: 'С255' },
                { value: 'C345', label: 'С345 (дороже, легче)' },
              ]}
              onChange={(v) => patch((d) => void (d.frame.steel = v))}
            />
          </Field>
          <Field label="Защитное покрытие" wide>
            <Select
              value={p.frame.coating}
              options={[
                { value: 'primer', label: 'Грунт ГФ-021' },
                { value: 'enamel', label: 'Грунт-эмаль в два слоя' },
                { value: 'zinc', label: 'Горячее цинкование' },
              ]}
              onChange={(v) => patch((d) => void (d.frame.coating = v))}
            />
          </Field>
          <Field label="Кран">
            <Select
              value={p.frame.crane.type}
              options={[
                { value: 'none', label: 'Нет' },
                { value: 'suspended', label: 'Подвесная кран-балка' },
                { value: 'bridge', label: 'Опорная кран-балка' },
              ]}
              onChange={(v) => patch((d) => void (d.frame.crane.type = v))}
            />
          </Field>
          {p.frame.crane.type !== 'none' ? (
            <Field label="Грузоподъёмность">
              <Num value={p.frame.crane.capacity} min={0.5} max={p.frame.crane.type === 'suspended' ? 5 : 20} unit="т" onChange={(v) => patch((d) => void (d.frame.crane.capacity = v))} />
            </Field>
          ) : null}
        </div>
      </Acc>

      <Acc
        title="Стены и кровля"
        summary={canopy ? 'Без стен' : `Стены ${p.envelope.walls === 'sandwich' ? `${p.envelope.wallThk} мм` : 'профлист'} · кровля ${p.envelope.roofing === 'sandwich' ? `${p.envelope.roofThk} мм` : 'профлист'}`}
        open={!!open.env}
        onToggle={() => toggle('env')}
      >
        <div className="fields">
          <Field label="Стены" wide>
            <Seg
              value={p.envelope.walls}
              label="Тип стен"
              options={[
                { value: 'sandwich', label: 'Сэндвич-панели' },
                { value: 'proflist', label: 'Профлист' },
                { value: 'none', label: 'Без стен' },
              ]}
              onChange={(v) => patch((d) => void (d.envelope.walls = v))}
            />
          </Field>
          {p.envelope.walls === 'sandwich' ? (
            <>
              <Field label="Утеплитель стен">
                <Select value={p.envelope.wallCore} options={CORE_OPTIONS} onChange={(v) => patch((d) => void (d.envelope.wallCore = v))} />
              </Field>
              <Field label="Толщина стен">
                <Select value={p.envelope.wallThk} options={THK_OPTIONS} onChange={(v) => patch((d) => void (d.envelope.wallThk = v))} />
              </Field>
              <Field label="Раскладка панелей" wide>
                <Seg
                  value={p.envelope.wallLayout}
                  label="Раскладка стеновых панелей"
                  options={[
                    { value: 'horizontal', label: 'Горизонтальная' },
                    { value: 'vertical', label: 'Вертикальная' },
                  ]}
                  onChange={(v) => patch((d) => void (d.envelope.wallLayout = v))}
                />
              </Field>
            </>
          ) : null}
          <Field label="Кровля" wide>
            <Seg
              value={p.envelope.roofing}
              label="Тип кровли"
              options={[
                { value: 'sandwich', label: 'Сэндвич-панели' },
                { value: 'proflist', label: 'Профлист' },
              ]}
              onChange={(v) => patch((d) => void (d.envelope.roofing = v))}
            />
          </Field>
          {p.envelope.roofing === 'sandwich' ? (
            <>
              <Field label="Утеплитель кровли">
                <Select value={p.envelope.roofCore} options={CORE_OPTIONS} onChange={(v) => patch((d) => void (d.envelope.roofCore = v))} />
              </Field>
              <Field label="Толщина кровли">
                <Select value={p.envelope.roofThk} options={THK_OPTIONS} onChange={(v) => patch((d) => void (d.envelope.roofThk = v))} />
              </Field>
            </>
          ) : null}
        </div>
        {b.heated && (th.wall.status !== 'na' || th.roof.status !== 'na') ? (
          <div className={`notice small ${th.wall.status === 'low' || th.roof.status === 'low' ? 'bad' : 'info'}`}>
            По теплозащите для {num(b.tInside)} °C нужно: стены не менее {th.wall.recommended} мм, кровля не менее {th.roof.recommended} мм.
            {th.wall.thk !== th.wall.recommended || th.roof.thk !== th.roof.recommended ? (
              <>
                {' '}
                <button type="button" className="btn sm" onClick={applyRecommended}>
                  Применить
                </button>
              </>
            ) : (
              ' Выбранные толщины соответствуют.'
            )}
          </div>
        ) : null}
        <div className="fields">
          {!canopy ? <Swatches label="Цвет стен" value={p.envelope.wallColor} onChange={(v) => patch((d) => void (d.envelope.wallColor = v))} /> : null}
          <Swatches label="Цвет кровли" value={p.envelope.roofColor} onChange={(v) => patch((d) => void (d.envelope.roofColor = v))} />
          <Swatches label="Цвет фасонных элементов" value={p.envelope.trimColor} onChange={(v) => patch((d) => void (d.envelope.trimColor = v))} />
          <Check checked={p.envelope.gutters} onChange={(v) => patch((d) => void (d.envelope.gutters = v))}>
            Водосточная система
          </Check>
          <Check checked={p.envelope.snowGuards} onChange={(v) => patch((d) => void (d.envelope.snowGuards = v))}>
            Снегозадержатели
          </Check>
          <Field label="Перегородки из сэндвич-панелей">
            <Num value={p.envelope.partitionsArea} min={0} max={20000} unit="м²" onChange={(v) => patch((d) => void (d.envelope.partitionsArea = v))} />
          </Field>
          <Field label="Толщина перегородок">
            <Select value={p.envelope.partitionThk} options={THK_OPTIONS} onChange={(v) => patch((d) => void (d.envelope.partitionThk = v))} />
          </Field>
        </div>
      </Acc>

      <Acc title="Проёмы" summary={canopy ? 'Нет стен' : `${openingCount} шт.`} open={!!open.openings} onToggle={() => toggle('openings')}>
        {canopy ? (
          <p className="muted small">У навеса без стен проёмы не считаются.</p>
        ) : (
          <>
            {p.openings.map((o) => (
              <OpeningEditor key={o.id} o={o} wallHeight={calc.geo.eaveHeight} />
            ))}
            <div className="row">
              {(['gate', 'door', 'window'] as OpeningKind[]).map((k) => (
                <button key={k} type="button" className="btn sm" onClick={() => patch((d) => void d.openings.push({ ...NEW_OPENING[k], id: uid() }))}>
                  + {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <p className="muted small">Проёмы без привязки расставляются равномерно и сдвигаются с колонн. Расстановка мышью появится на втором этапе.</p>
          </>
        )}
      </Acc>

      <Acc title="Фундамент и полы" summary={FOUNDATION_LABEL[p.foundation.type]} open={!!open.found} onToggle={() => toggle('found')}>
        <div className="fields">
          <Field label="Тип фундамента" wide>
            <Select
              value={p.foundation.type}
              options={(Object.keys(FOUNDATION_LABEL) as FoundationType[]).map((t) => ({ value: t, label: FOUNDATION_LABEL[t] }))}
              onChange={(v) => patch((d) => void (d.foundation.type = v))}
            />
          </Field>
        </div>
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
          {calc.foundation.details.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <div className="fields">
          {p.foundation.type !== 'slab' ? (
            <Field label="Полы">
              <Select
                value={p.foundation.floor}
                options={[
                  { value: 'none', label: 'Не делаем' },
                  { value: 'concrete', label: 'Бетонные по грунту' },
                ]}
                onChange={(v) => patch((d) => void (d.foundation.floor = v))}
              />
            </Field>
          ) : null}
          {p.foundation.type !== 'slab' && p.foundation.floor === 'concrete' ? (
            <Field label="Толщина пола">
              <Num value={p.foundation.floorThk} min={80} max={400} unit="мм" onChange={(v) => patch((d) => void (d.foundation.floorThk = Math.round(v)))} />
            </Field>
          ) : null}
          <Check checked={p.foundation.topping} onChange={(v) => patch((d) => void (d.foundation.topping = v))}>
            Упрочнение топпингом
          </Check>
          <Check checked={p.foundation.blindArea} onChange={(v) => patch((d) => void (d.foundation.blindArea = v))}>
            Отмостка
          </Check>
        </div>
      </Acc>

      <Acc title="Электрика и лестницы" summary={p.electric.enabled ? 'Электрика включена' : 'Без электрики'} open={!!open.extra} onToggle={() => toggle('extra')}>
        <div className="fields">
          <Check checked={p.electric.enabled} onChange={(v) => patch((d) => void (d.electric.enabled = v))}>
            Электромонтажные работы
          </Check>
          {p.electric.enabled ? (
            <Field label="Состав">
              <Select
                value={p.electric.level}
                options={[
                  { value: 'basic', label: 'Освещение и розетки' },
                  { value: 'standard', label: 'С распределительным щитом' },
                  { value: 'power', label: 'С силовой сетью' },
                ]}
                onChange={(v) => patch((d) => void (d.electric.level = v))}
              />
            </Field>
          ) : null}
          {b.floors > 1 ? (
            <Field label="Металлических лестниц" hint="Пусто — по расчёту: одна на 500 м² этажа">
              <Num
                value={p.stairs}
                min={0}
                max={40}
                unit="шт"
                placeholder="авто"
                onChange={(v) => patch((d) => void (d.stairs = Math.round(v)))}
                onClear={() => patch((d) => void (d.stairs = null))}
              />
            </Field>
          ) : null}
        </div>
      </Acc>

      <Acc
        title="Коммерция"
        summary={`Наценка ${num(p.commercial.markupMat)}/${num(p.commercial.markupWork)}%${p.commercial.discount ? ` · скидка ${num(p.commercial.discount)}%` : ''}`}
        open={!!open.com}
        onToggle={() => toggle('com')}
      >
        <div className="fields">
          <Field label="КП выставляет" wide hint={vatLabel(entity)}>
            <Select
              value={entity?.id ?? ''}
              options={settings.entities.map((e) => ({ value: e.id, label: e.name || 'Без названия' }))}
              onChange={(v) => patch((d) => void (d.commercial.entityId = v))}
            />
          </Field>
          <Field label="Наценка на материалы">
            <Num value={p.commercial.markupMat} min={0} max={300} unit="%" onChange={(v) => patch((d) => void (d.commercial.markupMat = v))} />
          </Field>
          <Field label="Наценка на работы">
            <Num value={p.commercial.markupWork} min={0} max={300} unit="%" onChange={(v) => patch((d) => void (d.commercial.markupWork = v))} />
          </Field>
          <Field label="Скидка клиенту">
            <Num value={p.commercial.discount} min={0} max={50} unit="%" onChange={(v) => patch((d) => void (d.commercial.discount = v))} />
          </Field>
          <Field label="Резерв на непредвиденные">
            <Num value={p.commercial.contingency} min={0} max={30} unit="%" onChange={(v) => patch((d) => void (d.commercial.contingency = v))} />
          </Field>
          <Field label="Номер КП">
            <Text value={p.number} onChange={(v) => patch((d) => void (d.number = v))} />
          </Field>
          <Field label="Срок действия КП">
            <Num value={p.commercial.validDays} min={1} max={180} unit="дн" onChange={(v) => patch((d) => void (d.commercial.validDays = Math.round(v)))} />
          </Field>
          <Field label="Условия оплаты" wide>
            <textarea value={p.commercial.paymentTerms} onChange={(e) => patch((d) => void (d.commercial.paymentTerms = e.target.value))} />
          </Field>
          <Field label="Примечания для КП" wide>
            <textarea value={p.commercial.notes} placeholder="Особые условия, пожелания клиента" onChange={(e) => patch((d) => void (d.commercial.notes = e.target.value))} />
          </Field>
          <Field label="Менеджер" wide>
            <Text value={p.manager.name} placeholder="ФИО" onChange={(v) => patch((d) => void (d.manager.name = v))} />
          </Field>
          <Field label="Телефон менеджера">
            <Text type="tel" value={p.manager.phone} onChange={(v) => patch((d) => void (d.manager.phone = v))} />
          </Field>
          <Field label="Email менеджера">
            <Text type="email" value={p.manager.email} onChange={(v) => patch((d) => void (d.manager.email = v))} />
          </Field>
        </div>
      </Acc>
    </div>
  );
}

export type { Project };
