// Раздел «Цены и настройки»: справочник цен, юридические лица, оформление КП.

import { useMemo, useState } from 'react';
import { uid } from '../domain/presets';
import { DEFAULT_PRICES, PRICE_GROUPS } from '../domain/prices';
import { VAT_OPTIONS } from '../domain/settings';
import type { LegalEntity, PriceItem, VatMode } from '../domain/types';
import { useApp } from '../state/store';
import { Field, Num, Select, Text } from './fields';
import { SANDBOX, downloadJson, pickImage, pickJson } from './files';
import { nf, plural } from './format';
import './admin.css';

const DEFAULTS = new Map(DEFAULT_PRICES.map((p) => [p.id, p]));

function isChanged(p: PriceItem): boolean {
  const d = DEFAULTS.get(p.id);
  return !!d && (d.mat !== p.mat || d.work !== p.work);
}

/** Кнопка с подтверждением на странице: первый клик «взводит», второй выполняет */
export function ConfirmButton({
  label,
  question = 'Точно удалить?',
  onConfirm,
  disabled,
  title,
}: {
  label: string;
  question?: string;
  onConfirm(): void;
  disabled?: boolean;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className="btn sm danger" disabled={disabled} title={title} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="admin-confirm">
      <button
        type="button"
        className="btn sm danger"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {question}
      </button>
      <button type="button" className="btn sm ghost" onClick={() => setArmed(false)}>
        Отмена
      </button>
    </span>
  );
}

function PriceTable() {
  const { settings, patchSettings } = useApp();
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<{ kind: 'bad' | 'info'; text: string } | null>(null);

  const changedCount = useMemo(() => settings.prices.filter(isChanged).length, [settings.prices]);
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      PRICE_GROUPS.map((g) => ({
        group: g,
        items: settings.prices.filter((p) => p.group === g && (!q || p.name.toLowerCase().includes(q) || g.toLowerCase().includes(q))),
      })).filter((g) => g.items.length),
    [settings.prices, q],
  );

  const setPrice = (id: string, key: 'mat' | 'work', v: number) =>
    patchSettings((d) => {
      const it = d.prices.find((x) => x.id === id);
      if (it) it[key] = v;
    });

  const resetRow = (id: string) =>
    patchSettings((d) => {
      const it = d.prices.find((x) => x.id === id);
      const def = DEFAULTS.get(id);
      if (it && def) {
        it.mat = def.mat;
        it.work = def.work;
      }
    });

  const loadFromFile = async () => {
    const raw = await pickJson();
    if (raw == null) {
      setMessage({ kind: 'bad', text: 'Файл не выбран или не читается. Нужен файл цен, сохранённый из этого раздела (формат JSON).' });
      return;
    }
    const valid = new Map<string, { mat: number; work: number }>();
    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        if (typeof r.id !== 'string' || !DEFAULTS.has(r.id)) continue;
        const mat = Number(r.mat);
        const work = Number(r.work);
        if (!Number.isFinite(mat) || !Number.isFinite(work) || mat < 0 || work < 0) continue;
        valid.set(r.id, { mat, work });
      }
    }
    if (!valid.size) {
      setMessage({ kind: 'bad', text: 'В файле не найдено ни одной позиции справочника. Нужен файл цен, сохранённый кнопкой «Сохранить цены в файл».' });
      return;
    }
    patchSettings((d) => {
      for (const it of d.prices) {
        const v = valid.get(it.id);
        if (v) {
          it.mat = v.mat;
          it.work = v.work;
        }
      }
    });
    setMessage({ kind: 'info', text: `Цены загружены: ${valid.size} ${plural(valid.size, 'позиция', 'позиции', 'позиций')}.` });
  };

  return (
    <section className="card">
      <div className="card-head">
        <h3>Справочник цен</h3>
        <span className={`pill${changedCount ? ' warn' : ''}`}>
          изменено {nf(changedCount)} {plural(changedCount, 'позиция', 'позиции', 'позиций')}
        </span>
      </div>
      <div className="card-body stack">
        <div className="admin-toolbar">
          <input
            id="price-search"
            className="input"
            type="search"
            placeholder="Поиск по названию"
            aria-label="Поиск по справочнику цен"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!SANDBOX ? (
            <>
              <button type="button" className="btn sm" onClick={() => downloadJson('цены.json', settings.prices)}>
                Сохранить цены в файл
              </button>
              <button type="button" className="btn sm" onClick={loadFromFile}>
                Загрузить цены из файла
              </button>
            </>
          ) : null}
          <ConfirmButton
            label="Сбросить все цены"
            question="Вернуть все цены по умолчанию?"
            disabled={!changedCount}
            onConfirm={() => {
              patchSettings((d) => {
                d.prices = DEFAULT_PRICES.map((p) => ({ ...p }));
              });
              setMessage(null);
            }}
          />
        </div>
        {message ? (
          <div className={`notice ${message.kind}`} role="status">
            {message.text}
          </div>
        ) : null}
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Наименование</th>
              <th>Ед.</th>
              <th className="r">Материал, ₽</th>
              <th className="r">Работа, ₽</th>
              <th aria-label="Сброс" />
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  По запросу «{query}» ничего не найдено.
                </td>
              </tr>
            ) : null}
            {groups.map((g) => [
              <tr key={g.group} className="sec">
                <td colSpan={5}>{g.group}</td>
              </tr>,
              ...g.items.map((p) => {
                const def = DEFAULTS.get(p.id);
                const pct = p.unit === '%';
                const matChanged = !!def && def.mat !== p.mat;
                const workChanged = !!def && def.work !== p.work;
                return (
                  <tr key={p.id}>
                    <td className="wrap">{p.name}</td>
                    <td>{p.unit}</td>
                    <td className="r">
                      {pct ? (
                        <span className="muted">—</span>
                      ) : (
                        <Num
                          id={`price-${p.id}-mat`}
                          ariaLabel={`${p.name}: материал, ₽ за ${p.unit}`}
                          className={`cell-input${matChanged ? ' changed' : ''}`}
                          value={p.mat}
                          min={0}
                          onChange={(v) => setPrice(p.id, 'mat', v)}
                        />
                      )}
                    </td>
                    <td className="r">
                      <span className="price-cell">
                        <Num
                          id={`price-${p.id}-work`}
                          ariaLabel={pct ? `${p.name}: процент` : `${p.name}: работа, ₽ за ${p.unit}`}
                          className={`cell-input${workChanged ? ' changed' : ''}`}
                          value={p.work}
                          min={0}
                          max={pct ? 100 : undefined}
                          onChange={(v) => setPrice(p.id, 'work', v)}
                        />
                        {pct ? <span className="muted">%</span> : null}
                      </span>
                    </td>
                    <td className="c">
                      {matChanged || workChanged ? (
                        <button
                          type="button"
                          className="btn sm ghost price-reset"
                          aria-label="Вернуть цену по умолчанию"
                          title={def ? `По умолчанию: материал ${nf(def.mat)}, работа ${nf(def.work)}` : undefined}
                          onClick={() => resetRow(p.id)}
                        >
                          ↺
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function vatKey(mode: VatMode, rate: number): string {
  return `${mode}:${mode === 'none' ? 0 : rate}`;
}

function EntityCard({ entity, canDelete }: { entity: LegalEntity; canDelete: boolean }) {
  const { patchSettings } = useApp();
  const set = (fn: (e: LegalEntity) => void) =>
    patchSettings((d) => {
      const e = d.entities.find((x) => x.id === entity.id);
      if (e) fn(e);
    });
  const options = VAT_OPTIONS.map((o) => ({ value: vatKey(o.vatMode, o.vatRate), label: o.label as string }));
  const current = vatKey(entity.vatMode, entity.vatRate);
  if (!options.some((o) => o.value === current)) options.push({ value: current, label: `НДС ${entity.vatRate}%` });
  const pid = `ent-${entity.id}`;
  return (
    <div className="card entity-card">
      <div className="card-head">
        <h3>{entity.name || 'Новое юрлицо'}</h3>
        <ConfirmButton
          label="Удалить"
          disabled={!canDelete}
          title={canDelete ? undefined : 'Должно остаться хотя бы одно юрлицо'}
          onConfirm={() =>
            patchSettings((d) => {
              if (d.entities.length > 1) d.entities = d.entities.filter((x) => x.id !== entity.id);
            })
          }
        />
      </div>
      <div className="card-body">
        <div className="fields">
          <Field label="Название" wide>
            <Text id={`${pid}-name`} value={entity.name} placeholder="ООО «…»" onChange={(v) => set((e) => (e.name = v))} />
          </Field>
          <Field label="ИНН">
            <Text id={`${pid}-inn`} value={entity.inn} onChange={(v) => set((e) => (e.inn = v))} />
          </Field>
          <Field label="КПП">
            <Text id={`${pid}-kpp`} value={entity.kpp} onChange={(v) => set((e) => (e.kpp = v))} />
          </Field>
          <Field label="Адрес" wide>
            <Text id={`${pid}-address`} value={entity.address} onChange={(v) => set((e) => (e.address = v))} />
          </Field>
          <Field label="Телефон">
            <Text id={`${pid}-phone`} type="tel" value={entity.phone} onChange={(v) => set((e) => (e.phone = v))} />
          </Field>
          <Field label="Email">
            <Text id={`${pid}-email`} type="email" value={entity.email} onChange={(v) => set((e) => (e.email = v))} />
          </Field>
          <Field label="Банковские реквизиты" wide>
            <textarea
              id={`${pid}-bank`}
              value={entity.bank}
              placeholder="Расчётный счёт, банк, БИК, корр. счёт"
              onChange={(ev) => set((e) => (e.bank = ev.target.value))}
            />
          </Field>
          <Field label="Режим НДС" wide>
            <Select
              id={`${pid}-vat`}
              value={current}
              options={options}
              onChange={(v) => {
                const [mode, rate] = v.split(':');
                set((e) => {
                  e.vatMode = mode === 'none' ? 'none' : 'included';
                  e.vatRate = Number(rate) || 0;
                });
              }}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Entities() {
  const { settings, patchSettings } = useApp();
  return (
    <section className="stack">
      <div className="row">
        <h3 className="grow">Юридические лица</h3>
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            patchSettings((d) => {
              d.entities.push({
                id: uid(),
                name: '',
                inn: '',
                kpp: '',
                address: '',
                phone: '',
                email: '',
                bank: '',
                vatMode: 'included',
                vatRate: 22,
              });
            })
          }
        >
          Добавить юрлицо
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        В расчёте менеджер выбирает, от какого юрлица выставляется КП; от этого зависит строка про НДС в КП и смете.
      </p>
      <div>
        {settings.entities.map((e) => (
          <EntityCard key={e.id} entity={e} canDelete={settings.entities.length > 1} />
        ))}
      </div>
    </section>
  );
}

function Branding() {
  const { settings, patchSettings } = useApp();
  const [logoError, setLogoError] = useState(false);
  return (
    <section className="card">
      <div className="card-head">
        <h3>Оформление КП</h3>
      </div>
      <div className="card-body stack">
        <div className="fields">
          <Field label="Название компании">
            <Text id="brand-name" value={settings.brand} onChange={(v) => patchSettings((d) => (d.brand = v))} />
          </Field>
          <Field label="Сайт">
            <Text id="brand-site" value={settings.site} placeholder="example.ru" onChange={(v) => patchSettings((d) => (d.site = v))} />
          </Field>
          <Field label="Подпись под названием" wide>
            <Text id="brand-slogan" value={settings.slogan} onChange={(v) => patchSettings((d) => (d.slogan = v))} />
          </Field>
        </div>
        <div>
          <div className="field-label" style={{ marginBottom: 6 }}>
            Логотип
          </div>
          <div className="logo-box">
            {settings.logo ? <img className="logo-preview" src={settings.logo} alt="Логотип компании" /> : <span className="muted small">Логотип не загружен: в шапке КП будет название компании.</span>}
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                const data = await pickImage();
                if (!data) {
                  setLogoError(true);
                  return;
                }
                setLogoError(false);
                patchSettings((d) => (d.logo = data));
              }}
            >
              Загрузить логотип
            </button>
            {settings.logo ? (
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => {
                  setLogoError(false);
                  patchSettings((d) => (d.logo = ''));
                }}
              >
                Убрать логотип
              </button>
            ) : null}
          </div>
          {logoError ? (
            <div className="notice bad" role="status" style={{ marginTop: 8 }}>
              Файл не подошёл. Нужна картинка PNG, JPG или SVG размером до 400 КБ.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function PricesView() {
  return (
    <div className="page stack">
      <div className="notice" role="note">
        <b>Цены в справочнике ориентировочные.</b> Это рыночные значения для примера: перед работой с клиентами замените их ценами компании. Все цены — себестоимость без наценки
        (материал и работа за единицу); наценка на материалы и работы задаётся в самом расчёте.
      </div>
      <PriceTable />
      <Entities />
      <Branding />
    </div>
  );
}
