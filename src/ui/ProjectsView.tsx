// Раздел «Расчёты»: создание нового расчёта по шаблону, список сохранённых, перенос файлом.

import { useState } from 'react';
import { BUILDING_TYPES, PRESETS } from '../domain/presets';
import type { Project } from '../domain/types';
import { useApp } from '../state/store';
import { SANDBOX, downloadJson, pickJson, safeFileName } from './files';
import { dateTimeRu, num } from './format';
import { ConfirmButton } from './PricesView';
import './admin.css';

function objectLabel(p: Project): string {
  const b = p.building;
  const label = PRESETS[b.type]?.label ?? 'Здание';
  return `${label} ${num(b.width)}×${num(b.length)}×${num(b.height)} м`;
}

export function ProjectsView({ onOpen }: { onOpen(): void }) {
  const { project, projects, create, open, duplicate, remove, importProject } = useApp();
  const [importError, setImportError] = useState(false);

  const loadFromFile = async () => {
    const raw = await pickJson();
    if (raw == null || !importProject(raw)) {
      setImportError(true);
      return;
    }
    setImportError(false);
    onOpen();
  };

  return (
    <div className="page stack">
      <section className="card">
        <div className="card-head">
          <h3>Новый расчёт</h3>
          {!SANDBOX ? (
            <button type="button" className="btn sm" onClick={loadFromFile}>
              Загрузить расчёт из файла
            </button>
          ) : null}
        </div>
        <div className="card-body stack">
          <div className="muted small">Выберите тип здания: расчёт откроется с типовыми габаритами и решениями, которые можно изменить.</div>
          <div className="type-grid">
            {BUILDING_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className="type-btn"
                onClick={() => {
                  create(type);
                  onOpen();
                }}
              >
                <b>{PRESETS[type].label}</b>
                <span>{PRESETS[type].hint}</span>
              </button>
            ))}
          </div>
          {importError ? (
            <div className="notice bad" role="status">
              Файл не похож на расчёт модуля. Нужен файл, сохранённый кнопкой «В файл» в этом разделе.
            </div>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Сохранённые расчёты</h3>
          <span className="muted small">{projects.length ? `всего ${projects.length}` : ''}</span>
        </div>
        {projects.length === 0 ? (
          <div className="card-body">
            <div className="empty">Сохранённых расчётов пока нет. Расчёт сохраняется автоматически, как только вы начинаете его менять.</div>
          </div>
        ) : null}
        {projects.length > 0 ? (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="t">
              <thead>
                <tr>
                  <th>№ КП</th>
                  <th>Название</th>
                  <th>Клиент</th>
                  <th>Объект</th>
                  <th>Изменён</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const current = p.id === project.id;
                  return (
                    <tr key={p.id}>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {p.number}
                      </td>
                      <td className="wrap">
                        {p.name || 'Без названия'} {current ? <span className="pill blue">открыт</span> : null}
                      </td>
                      <td>{p.client.name || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{objectLabel(p)}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {dateTimeRu(p.updatedAt)}
                      </td>
                      <td>
                        <div className="admin-actions">
                          <button
                            type="button"
                            className="btn sm primary"
                            onClick={() => {
                              open(p.id);
                              onOpen();
                            }}
                          >
                            Открыть
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => {
                              duplicate(p.id);
                              onOpen();
                            }}
                          >
                            Копия
                          </button>
                          {!SANDBOX ? (
                            <button type="button" className="btn sm" onClick={() => downloadJson(`${safeFileName(`КП ${p.number} ${p.name}`)}.json`, p)}>
                              В файл
                            </button>
                          ) : null}
                          <ConfirmButton label="Удалить" onConfirm={() => remove(p.id)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <div className="muted small">
        Расчёты хранятся в этом браузере на этом компьютере. Чтобы передать расчёт коллеге или перенести на другой компьютер, сохраните его в файл.
      </div>
    </div>
  );
}
