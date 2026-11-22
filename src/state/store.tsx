// Состояние приложения: текущий расчёт, настройки, список сохранённых расчётов.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { calcProject, type CalcResult } from '../domain/calc';
import { kpNumber, newProject, uid } from '../domain/presets';
import type { BuildingType, Project, Settings } from '../domain/types';
import { LocalRepository, migrateProject, type Repository } from './repository';

interface AppContext {
  project: Project;
  settings: Settings;
  projects: Project[];
  calc: CalcResult;
  /** изменить текущий расчёт: функция получает копию и правит её на месте */
  patch(fn: (draft: Project) => void): void;
  replace(p: Project): void;
  create(type: BuildingType): void;
  open(id: string): void;
  duplicate(id: string): void;
  remove(id: string): void;
  importProject(raw: unknown): boolean;
  patchSettings(fn: (draft: Settings) => void): void;
  /**
   * Передвинуть один проём мышью. blockId — пустая строка для основного здания.
   * u — привязка от начала стены, м; sill — новая отметка низа (для окон), если меняется.
   */
  moveOpening(blockId: string, openingId: string, index: number, u: number, sill?: number): void;
}

const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider не подключён');
  return v;
}

const repo: Repository = new LocalRepository();

function initialProject(settings: Settings): Project {
  const list = repo.listProjects();
  const current = repo.getCurrentId();
  const found = list.find((p) => p.id === current) ?? list[0];
  if (found) return found;
  const p = newProject('hangar', settings.entities[0]?.id ?? '');
  p.name = 'Пример: ангар 18×36 м';
  return p;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => repo.loadSettings());
  const [project, setProject] = useState<Project>(() => initialProject(settings));
  const [projects, setProjects] = useState<Project[]>(() => repo.listProjects());

  // автосохранение текущего расчёта
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      repo.saveProject(project);
      repo.setCurrentId(project.id);
      setProjects(repo.listProjects());
    }, 400);
    return () => window.clearTimeout(timer.current);
  }, [project]);

  useEffect(() => {
    repo.saveSettings(settings);
  }, [settings]);

  const patch = useCallback((fn: (draft: Project) => void) => {
    setProject((prev) => {
      const draft = structuredClone(prev);
      fn(draft);
      draft.updatedAt = new Date().toISOString();
      return draft;
    });
  }, []);

  const replace = useCallback((p: Project) => setProject(p), []);

  const create = useCallback(
    (type: BuildingType) => {
      const p = newProject(type, settings.entities[0]?.id ?? '');
      p.manager = { ...project.manager };
      setProject(p);
    },
    [settings.entities, project.manager],
  );

  const open = useCallback((id: string) => {
    const found = repo.listProjects().find((p) => p.id === id);
    if (found) setProject(found);
  }, []);

  const duplicate = useCallback((id: string) => {
    const found = repo.listProjects().find((p) => p.id === id);
    if (!found) return;
    const now = new Date().toISOString();
    const copy: Project = { ...structuredClone(found), id: uid(), number: kpNumber(), name: `${found.name || 'Расчёт'} — копия`, createdAt: now, updatedAt: now };
    repo.saveProject(copy);
    setProject(copy);
  }, []);

  const remove = useCallback(
    (id: string) => {
      repo.deleteProject(id);
      const rest = repo.listProjects();
      setProjects(rest);
      if (id === project.id) setProject(rest[0] ?? newProject('hangar', settings.entities[0]?.id ?? ''));
    },
    [project.id, settings.entities],
  );

  const importProject = useCallback((raw: unknown) => {
    const p = migrateProject(raw);
    if (!p) return false;
    // импортированный расчёт получает новый идентификатор, чтобы не затереть существующий
    const copy = { ...p, id: uid(), updatedAt: new Date().toISOString() };
    repo.saveProject(copy);
    setProject(copy);
    return true;
  }, []);

  const patchSettings = useCallback((fn: (draft: Settings) => void) => {
    setSettings((prev) => {
      const draft = structuredClone(prev);
      fn(draft);
      return draft;
    });
  }, []);

  const calc = useMemo(() => calcProject(project, settings), [project, settings]);
  const calcRef = useRef(calc);
  calcRef.current = calc;

  const moveOpening = useCallback(
    (blockId: string, openingId: string, index: number, u: number, sill?: number) => {
      patch((d) => {
        const list = blockId ? d.annexes.find((a) => a.id === blockId)?.openings : d.openings;
        const o = list?.find((x) => x.id === openingId);
        if (!o) return;
        const snap = (v: number) => Math.round(v * 20) / 20;
        // при первом перетаскивании фиксируем текущие места всех проёмов группы, чтобы остальные не съехали
        if (!o.positions || o.positions.length !== o.qty || o.positions.some((v) => v == null)) {
          const blk = calcRef.current.blocks.find((b) => b.id === blockId);
          const now = blk?.structure.openings.filter((it) => it.opening.id === openingId) ?? [];
          o.positions = Array.from({ length: o.qty }, (_, i) => snap(now.find((it) => it.index === i)?.u ?? 0));
        }
        o.positions[index] = Math.max(0, snap(u));
        if (sill != null) o.sill = Math.max(0, snap(sill));
      });
    },
    [patch],
  );

  const value = useMemo<AppContext>(
    () => ({ project, settings, projects, calc, patch, replace, create, open, duplicate, remove, importProject, patchSettings, moveOpening }),
    [project, settings, projects, calc, patch, replace, create, open, duplicate, remove, importProject, patchSettings, moveOpening],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
