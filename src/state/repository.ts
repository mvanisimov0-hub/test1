// Хранилище расчётов и настроек.
// Сейчас данные лежат в браузере менеджера. Интерфейс Repository — граница, по которой
// на следующем этапе подключается общий сервер: остальной код от места хранения не зависит.

import { newProject } from '../domain/presets';
import { normalizeSettings } from '../domain/settings';
import { SCHEMA_VERSION, type Project, type Settings } from '../domain/types';

export interface Repository {
  listProjects(): Project[];
  saveProject(p: Project): void;
  deleteProject(id: string): void;
  loadSettings(): Settings;
  saveSettings(s: Settings): void;
  getCurrentId(): string | null;
  setCurrentId(id: string): void;
}

const KEY_PROJECTS = 'sdv.projects.v1';
const KEY_SETTINGS = 'sdv.settings.v1';
const KEY_CURRENT = 'sdv.current.v1';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // хранилище недоступно (приватный режим, переполнение) — работаем без сохранения
  }
}

/** Привести расчёт из файла или старой версии к текущей модели: недостающие поля берутся из шаблона */
export function migrateProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Partial<Project>;
  if (!src.building || !src.building.type) return null;
  const base = newProject(src.building.type);
  const merged: Project = {
    ...base,
    ...src,
    schema: SCHEMA_VERSION,
    client: { ...base.client, ...src.client },
    manager: { ...base.manager, ...src.manager },
    building: { ...base.building, ...src.building },
    site: { ...base.site, ...src.site },
    frame: { ...base.frame, ...src.frame, crane: { ...base.frame.crane, ...src.frame?.crane } },
    envelope: { ...base.envelope, ...src.envelope },
    foundation: { ...base.foundation, ...src.foundation },
    electric: { ...base.electric, ...src.electric },
    commercial: { ...base.commercial, ...src.commercial },
    openings: Array.isArray(src.openings) ? src.openings.map((o) => ({ ...o, offset: o.offset ?? null })) : base.openings,
    overrides: src.overrides ?? {},
    customLines: Array.isArray(src.customLines) ? src.customLines : [],
    annexes: Array.isArray(src.annexes) ? src.annexes : [],
  };
  return merged;
}

export class LocalRepository implements Repository {
  listProjects(): Project[] {
    const map = read<Record<string, unknown>>(KEY_PROJECTS) ?? {};
    return Object.values(map)
      .map(migrateProject)
      .filter((p): p is Project => !!p)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  saveProject(p: Project): void {
    const map = read<Record<string, Project>>(KEY_PROJECTS) ?? {};
    map[p.id] = p;
    write(KEY_PROJECTS, map);
  }

  deleteProject(id: string): void {
    const map = read<Record<string, Project>>(KEY_PROJECTS) ?? {};
    delete map[id];
    write(KEY_PROJECTS, map);
  }

  loadSettings(): Settings {
    return normalizeSettings(read<Partial<Settings>>(KEY_SETTINGS));
  }

  saveSettings(s: Settings): void {
    write(KEY_SETTINGS, s);
  }

  getCurrentId(): string | null {
    try {
      return localStorage.getItem(KEY_CURRENT);
    } catch {
      return null;
    }
  }

  setCurrentId(id: string): void {
    try {
      localStorage.setItem(KEY_CURRENT, id);
    } catch {
      // см. write()
    }
  }
}
