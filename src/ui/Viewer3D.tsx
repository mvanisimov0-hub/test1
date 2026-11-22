// Интерактивный 3D-вид здания и получение картинок для документов.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CalcResult } from '../domain/calc';
import type { Project } from '../domain/types';
import { Seg } from './fields';
import { addLights, buildScene, cameraFor, disposeGroup, type OpeningTag, type SceneTheme, type ViewMode, type ViewPreset } from './scene';

const FOV = 32;

function readTheme(el: Element): SceneTheme {
  const cs = getComputedStyle(el);
  const ground = cs.getPropertyValue('--ground').trim() || '#c8cfd5';
  return { ground, pad: new THREE.Color(ground).multiplyScalar(0.86).getStyle() };
}

/** Картинка здания для КП: рисуется отдельным рендерером на светлом фоне */
export function renderSnapshot(p: Project, calc: CalcResult, mode: ViewMode, view: ViewPreset = 'iso', width = 1400, height = 820): string | null {
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f5f7);
    addLights(scene, p, calc);
    const group = buildScene(p, calc, mode, { ground: '#dfe3e7', pad: '#c3c8cd' });
    scene.add(group);
    const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 5000);
    const c = cameraFor(p, calc, view, width / height, FOV);
    camera.position.copy(c.position);
    camera.lookAt(c.target);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/jpeg', 0.9);
    disposeGroup(group);
    return url;
  } catch {
    return null;
  } finally {
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }
}

const MODES: { value: ViewMode; label: string }[] = [
  { value: 'clad', label: 'Обшивка' },
  { value: 'xray', label: 'Рентген' },
  { value: 'frame', label: 'Каркас' },
];

const VIEWS: { value: ViewPreset; label: string }[] = [
  { value: 'iso', label: 'Общий' },
  { value: 'back', label: 'С тыла' },
  { value: 'front', label: 'Торец' },
  { value: 'side', label: 'Фасад' },
  { value: 'top', label: 'Сверху' },
];

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group | null;
  lights: THREE.Object3D[];
  frame: number;
  dirty: boolean;
}

interface ViewerProps {
  project: Project;
  calc: CalcResult;
  /** перетаскивание проёма по стене: блок, проём, номер в группе, новая привязка */
  onMoveOpening?: (blockId: string, openingId: string, index: number, u: number) => void;
}

export function Viewer3D({ project, calc, onMoveOpening }: ViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [mode, setMode] = useState<ViewMode>('clad');
  const [view, setView] = useState<ViewPreset>('iso');
  const [failed, setFailed] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  // ключ габаритов: камера перестраивается только при их изменении, а не при каждой правке
  const sizeKey = `${calc.totals.bounds.map((v) => v.toFixed(1)).join('|')}|${Math.round(calc.totals.height * 10)}`;
  const moveRef = useRef(onMoveOpening);
  moveRef.current = onMoveOpening;
  const [dragInfo, setDragInfo] = useState<string | null>(null);

  // создание рендерера
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 16 / 10, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    const s: Stage = { renderer, scene, camera, controls, group: null, lights: [], frame: 0, dirty: true };
    stage.current = s;
    controls.addEventListener('change', () => (s.dirty = true));

    // ── перетаскивание проёмов по стенам ──
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const canvas = renderer.domElement;
    let drag: { tag: OpeningTag; origin: THREE.Vector3; dir: THREE.Vector3; plane: THREE.Plane; grab: number; last: number } | null = null;
    const pick = (ev: PointerEvent): { tag: OpeningTag; point: THREE.Vector3; obj: THREE.Object3D } | null => {
      if (!s.group) return null;
      const r = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      // линии швов панелей в расчёт не берём: у них широкая зона попадания
      const hits = ray.intersectObject(s.group, true).filter((h) => (h.object as THREE.Mesh).isMesh);
      if (!hits.length) return null;
      // проём считается выбранным, если его «ручка» — ближайшее к камере из того, что под курсором
      const near = hits[0].distance;
      for (const h of hits) {
        if (h.distance > near + 0.35) break;
        const tag = h.object.userData.opening as OpeningTag | undefined;
        if (tag) return { tag, point: h.point, obj: h.object };
      }
      return null;
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || !moveRef.current) return;
      const hit = pick(ev);
      if (!hit || !hit.obj.parent) return;
      const m = hit.obj.parent.matrixWorld;
      const origin = new THREE.Vector3(...hit.tag.origin).applyMatrix4(m);
      const dir = new THREE.Vector3(...hit.tag.dir).transformDirection(m);
      const normal = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point);
      const along = hit.point.clone().sub(origin).dot(dir);
      drag = { tag: hit.tag, origin, dir, plane, grab: along - hit.tag.u, last: hit.tag.u };
      controls.enabled = false;
      canvas.setPointerCapture(ev.pointerId);
      canvas.style.cursor = 'grabbing';
      ev.preventDefault();
    };
    const onMove = (ev: PointerEvent) => {
      if (!drag) {
        if (moveRef.current && ev.buttons === 0) canvas.style.cursor = pick(ev) ? 'grab' : '';
        return;
      }
      const r = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const pt = new THREE.Vector3();
      if (!ray.ray.intersectPlane(drag.plane, pt)) return;
      let u = pt.sub(drag.origin).dot(drag.dir) - drag.grab;
      u = Math.round(Math.min(Math.max(u, 0), Math.max(0, drag.tag.wallLen - drag.tag.w)) * 20) / 20;
      if (Math.abs(u - drag.last) < 1e-6) return;
      drag.last = u;
      setDragInfo(`Привязка от начала стены: ${u.toFixed(2).replace('.', ',')} м`);
      moveRef.current?.(drag.tag.blockId, drag.tag.openingId, drag.tag.index, u);
    };
    const onUp = (ev: PointerEvent) => {
      if (!drag) return;
      drag = null;
      controls.enabled = true;
      canvas.style.cursor = '';
      setDragInfo(null);
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    };
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      s.dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const loop = () => {
      s.frame = requestAnimationFrame(loop);
      controls.update();
      if (s.dirty) {
        s.dirty = false;
        renderer.render(scene, camera);
      }
    };
    loop();

    // смена темы оформления — перекрасить землю
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => setThemeTick((t) => t + 1);
    mq.addEventListener('change', onTheme);
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      cancelAnimationFrame(s.frame);
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      ro.disconnect();
      mq.removeEventListener('change', onTheme);
      mo.disconnect();
      controls.dispose();
      if (s.group) disposeGroup(s.group);
      renderer.dispose();
      renderer.domElement.remove();
      stage.current = null;
    };
  }, []);

  // перестроение модели
  useEffect(() => {
    const s = stage.current;
    const el = host.current;
    if (!s || !el) return;
    if (s.group) {
      s.scene.remove(s.group);
      disposeGroup(s.group);
    }
    for (const l of s.lights) s.scene.remove(l);
    const before = new Set(s.scene.children);
    addLights(s.scene, project, calc);
    s.lights = s.scene.children.filter((c) => !before.has(c));
    s.group = buildScene(project, calc, mode, readTheme(el));
    s.scene.add(s.group);
    s.scene.updateMatrixWorld(true);
    s.dirty = true;
  }, [project, calc, mode, themeTick]);

  // положение камеры
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    const c = cameraFor(project, calc, view, s.camera.aspect, FOV);
    s.camera.position.copy(c.position);
    s.controls.target.copy(c.target);
    s.controls.update();
    s.dirty = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, sizeKey]);

  return (
    <div className="viewer" ref={host}>
      {failed ? (
        <div className="viewer-fallback">3D-вид недоступен: браузер не поддерживает WebGL. Расчёт, смета и чертежи работают без него.</div>
      ) : (
        <>
          <div className="viewer-bar top">
            <Seg<ViewMode> value={mode} options={MODES} onChange={setMode} label="Режим отображения" />
            <span className="grow" />
            <Seg<ViewPreset> value={view} options={VIEWS} onChange={setView} label="Вид" />
          </div>
          <div className="viewer-bar bottom">
            <span className="viewer-caption">
              {dragInfo ?? (onMoveOpening ? 'Проёмы перетаскиваются мышью по стене. Вращение — левая кнопка, сдвиг — правая, масштаб — колесо' : 'Вращение — левая кнопка мыши, сдвиг — правая, масштаб — колесо')}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
