// Построение 3D-модели здания из результатов расчёта.
// Оси: X — вдоль здания, Y — вверх, Z — поперёк (как в расчётном ядре).

import * as THREE from 'three';
import type { BlockCalc, CalcResult } from '../domain/calc';
import { ral } from '../domain/colors';
import { wallLength } from '../domain/geometry';
import { sectionById } from '../domain/sections';
import type { ElementRole } from '../domain/structTypes';
import type { Project, WallSide } from '../domain/types';

export type ViewMode = 'clad' | 'frame' | 'xray';

export interface SceneTheme {
  ground: string;
  pad: string;
}

const STEEL: Record<string, number> = { primer: 0x8f3b2a, enamel: 0x7d868d, zinc: 0xb9bec2 };

function shade(hex: string, k: number): THREE.Color {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(k);
}

/** Вычесть из отрезка [a, b] набор интервалов */
function subtract(a: number, b: number, holes: [number, number][]): [number, number][] {
  let out: [number, number][] = [[a, b]];
  for (const [h1, h2] of holes) {
    const next: [number, number][] = [];
    for (const [s, e] of out) {
      if (h2 <= s || h1 >= e) next.push([s, e]);
      else {
        if (h1 > s) next.push([s, h1]);
        if (h2 < e) next.push([h2, e]);
      }
    }
    out = next;
  }
  return out.filter(([s, e]) => e - s > 0.02);
}

interface WallFrame {
  origin: THREE.Vector3;
  u: THREE.Vector3;
  n: THREE.Vector3;
}

/** Данные о проёме на его 3D-модели: по ним работает перетаскивание мышью */
export interface OpeningTag {
  blockId: string;
  openingId: string;
  index: number;
  wall: WallSide;
  /** ширина проёма и длина стены, м */
  w: number;
  wallLen: number;
  /** точка начала стены и направление вдоль неё в осях блока */
  origin: [number, number, number];
  dir: [number, number, number];
  /** привязка проёма на момент построения модели */
  u: number;
}

/** Модель одного блока в его собственных осях */
function buildBlock(p: Project, calc: BlockCalc, mode: ViewMode, theme: SceneTheme, isMain: boolean): THREE.Group {
  const root = new THREE.Group();
  const b = p.building;
  const env = p.envelope;
  const st = calc.structure;
  const L = b.length;
  const B = b.width;
  const tan = Math.tan((b.slopeDeg * Math.PI) / 180);
  const cos = Math.cos((b.slopeDeg * Math.PI) / 180);
  const hasWalls = env.walls !== 'none';
  const showClad = mode !== 'frame';
  // у навеса без стен каркас виден всегда
  const showFrame = mode !== 'clad' || !hasWalls;
  const xray = mode === 'xray';

  const wallT = env.walls === 'sandwich' ? Math.max(0.05, env.wallThk / 1000) : 0.04;
  const roofT = env.roofing === 'sandwich' ? Math.max(0.05, env.roofThk / 1000) : 0.06;
  const e = 0.12; // отступ внутренней грани стены от оси колонн
  const ov = calc.geo.overhang;
  const roofBase = b.height + st.roofOffset + st.purlinH;
  // нижняя грань кровли с продолжением ската на свес
  const roofUnder = (z: number) => {
    if (b.roof === 'mono') return roofBase + (B - z) * tan;
    return roofBase + (z <= B / 2 ? z : B - z) * tan;
  };

  const cladMat = (color: THREE.ColorRepresentation, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.62,
      metalness: 0.12,
      side: THREE.DoubleSide,
      transparent: xray,
      opacity: xray ? 0.2 : 1,
      depthWrite: !xray,
      ...opts,
    });

  const wallColor = ral(env.wallColor).hex;
  const roofColor = ral(env.roofColor).hex;
  const trimColor = ral(env.trimColor).hex;

  // ── основание ──

  const padW = p.foundation.blindArea ? 1.1 : 0.3;
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(L + 2 * (e + wallT + padW), 0.12, B + 2 * (e + wallT + padW)),
    new THREE.MeshStandardMaterial({ color: theme.pad, roughness: 0.95, metalness: 0 }),
  );
  pad.position.set(L / 2, -0.06, B / 2);
  pad.receiveShadow = true;
  root.add(pad);

  // фигура человека для масштаба
  if (isMain) {
    const man = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x35404c, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.05, 4, 10), mat);
    body.position.y = 0.72;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), mat);
    head.position.y = 1.62;
    man.add(body, head);
    man.position.set(-1.6, 0, -1.4 - padW);
    man.traverse((o) => (o.castShadow = true));
    root.add(man);
  }

  // ── стены ──
  const wallFrames: Record<WallSide, WallFrame> = {
    left: { origin: new THREE.Vector3(0, 0, -e), u: new THREE.Vector3(1, 0, 0), n: new THREE.Vector3(0, 0, -1) },
    right: { origin: new THREE.Vector3(0, 0, B + e), u: new THREE.Vector3(1, 0, 0), n: new THREE.Vector3(0, 0, 1) },
    front: { origin: new THREE.Vector3(-e, 0, 0), u: new THREE.Vector3(0, 0, 1), n: new THREE.Vector3(-1, 0, 0) },
    back: { origin: new THREE.Vector3(L + e, 0, 0), u: new THREE.Vector3(0, 0, 1), n: new THREE.Vector3(1, 0, 0) },
  };
  const up = new THREE.Vector3(0, 1, 0);
  const place = (wf: WallFrame, u: number, v: number, w: number) =>
    wf.origin.clone().addScaledVector(wf.u, u).addScaledVector(up, v).addScaledVector(wf.n, w);
  const basis = (wf: WallFrame) => new THREE.Matrix4().makeBasis(wf.u, up, wf.n).setPosition(wf.origin);

  if (hasWalls && showClad) {
    const wallMaterial = cladMat(wallColor);
    const seamMat = new THREE.LineBasicMaterial({ color: shade(wallColor, 0.88), transparent: xray, opacity: xray ? 0.25 : 1 });
    const trimMat = cladMat(trimColor, { roughness: 0.5 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x8fb4cf,
      roughness: 0.12,
      metalness: 0.55,
      transparent: true,
      opacity: xray ? 0.25 : 0.78,
      side: THREE.DoubleSide,
    });
    const gateMat = cladMat(0xb3b8bc, { roughness: 0.55 });
    const frameWhite = cladMat(0xf2f2ef);
    const gripMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const seams: number[] = [];
    const gateLines: number[] = [];
    const pushLine = (arr: number[], a: THREE.Vector3, c: THREE.Vector3) => arr.push(a.x, a.y, a.z, c.x, c.y, c.z);

    for (const wall of ['left', 'right', 'front', 'back'] as WallSide[]) {
      if (b.openSides?.includes(wall)) continue; // сторона примыкания к соседнему блоку
      const wf = wallFrames[wall];
      const len = wallLength(b, wall);
      const long = wall === 'left' || wall === 'right';
      const ext = long ? e + wallT : e; // продольные стены закрывают углы
      const zAt = (u: number) => (long ? (wall === 'left' ? 0 : B) : Math.min(Math.max(u, 0), B));
      const top = (u: number) => roofUnder(zAt(u));
      const u0 = -ext;
      const u1 = len + ext;

      const shape = new THREE.Shape();
      shape.moveTo(u0, 0);
      shape.lineTo(u1, 0);
      shape.lineTo(u1, top(u1));
      if (!long && b.roof === 'gable') shape.lineTo(B / 2, top(B / 2));
      shape.lineTo(u0, top(u0));
      shape.closePath();

      const items = st.openings.filter((o) => o.wall === wall);
      const holes: { u: number; v: number; w: number; h: number; kind: string; subtype: string; id: string; index: number }[] = [];
      for (const o of items) {
        const uu = Math.min(Math.max(o.u, 0.05), len - 0.1);
        const ww = Math.min(o.w, len - uu - 0.05);
        const limit = Math.min(top(uu), top(uu + ww)) - 0.12;
        const vv = Math.min(o.sill, Math.max(0, limit - 0.4));
        const hh = Math.min(o.h, limit - vv);
        if (ww < 0.2 || hh < 0.2) continue;
        const hole = new THREE.Path();
        hole.moveTo(uu, vv);
        hole.lineTo(uu + ww, vv);
        hole.lineTo(uu + ww, vv + hh);
        hole.lineTo(uu, vv + hh);
        hole.closePath();
        shape.holes.push(hole);
        holes.push({ u: uu, v: vv, w: ww, h: hh, kind: o.opening.kind, subtype: o.opening.subtype, id: o.opening.id, index: o.index });
      }

      const geo = new THREE.ExtrudeGeometry(shape, { depth: wallT, bevelEnabled: false });
      geo.applyMatrix4(basis(wf));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, wallMaterial);
      // тени на самих панелях не рисуем: на тонких стенах они дают полосы
      mesh.castShadow = !xray;
      root.add(mesh);

      // швы панелей на наружной грани
      const off = wallT + 0.006;
      const module = env.walls === 'proflist' ? 0.25 : 1.0;
      const vertical = env.walls === 'proflist' || env.wallLayout === 'vertical';
      const maxTop = Math.max(top(u0), top(u1), top(len / 2));
      if (vertical) {
        for (let u = module; u < len - 0.05; u += module) {
          const cut = holes.filter((h) => u > h.u && u < h.u + h.w).map((h) => [h.v, h.v + h.h] as [number, number]);
          for (const [a, c] of subtract(0, top(u), cut)) pushLine(seams, place(wf, u, a, off), place(wf, u, c, off));
        }
      } else {
        for (let v = module; v < maxTop - 0.05; v += module) {
          // участок стены, где её верх выше уровня шва
          let a = u0;
          let c = u1;
          if (!long && tan > 0) {
            const baseTop = roofBase;
            if (v > baseTop) {
              const d = (v - baseTop) / tan;
              if (b.roof === 'gable') {
                a = d;
                c = B - d;
              } else {
                c = B - d;
              }
            } else if (b.roof === 'mono' && v > top(u1)) {
              c = B - (v - baseTop) / tan;
            }
          }
          if (c - a < 0.05) continue;
          const cut = holes.filter((h) => v > h.v && v < h.v + h.h).map((h) => [h.u, h.u + h.w] as [number, number]);
          for (const [s, t] of subtract(a, c, cut)) pushLine(seams, place(wf, s, v, off), place(wf, t, v, off));
        }
      }

      // заполнение проёмов
      const box = (u: number, v: number, w: number, h: number, depth: number, wOff: number, mat: THREE.Material, shadow = false) => {
        const g = new THREE.BoxGeometry(w, h, depth);
        const m = new THREE.Mesh(g, mat);
        m.position.copy(place(wf, u + w / 2, v + h / 2, wOff + depth / 2));
        // поворот без отражения: третья ось — u × up (совпадает с нормалью стены или противоположна ей)
        m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(wf.u, up, new THREE.Vector3().crossVectors(wf.u, up)));
        m.castShadow = shadow;
        root.add(m);
        return m;
      };
      for (const h of holes) {
        const fr = 0.07;
        // невидимая «ручка» по всему проёму: за неё проём перетаскивается мышью
        const grip = box(h.u, h.v, h.w, h.h, wallT + 0.08, -0.02, gripMat);
        const tag: OpeningTag = {
          blockId: calc.id,
          openingId: h.id,
          index: h.index,
          wall,
          w: h.w,
          wallLen: len,
          origin: [wf.origin.x, 0, wf.origin.z],
          dir: [wf.u.x, 0, wf.u.z],
          u: h.u,
        };
        grip.userData.opening = tag;
        // обрамление проёма
        box(h.u - fr, h.v + h.h, h.w + 2 * fr, fr, 0.03, wallT, trimMat);
        box(h.u - fr, h.v, fr, h.h, 0.03, wallT, trimMat);
        box(h.u + h.w, h.v, fr, h.h, 0.03, wallT, trimMat);
        if (h.kind === 'window') box(h.u - fr, h.v - fr, h.w + 2 * fr, fr, 0.03, wallT, trimMat);

        if (h.kind === 'gate') {
          box(h.u, h.v, h.w, h.h, 0.05, wallT * 0.45, gateMat);
          const lo = wallT * 0.45 + 0.056;
          if (h.subtype === 'swing') {
            pushLine(gateLines, place(wf, h.u + h.w / 2, h.v, lo), place(wf, h.u + h.w / 2, h.v + h.h, lo));
          } else {
            for (let v = h.v + 0.5; v < h.v + h.h - 0.1; v += 0.5) pushLine(gateLines, place(wf, h.u, v, lo), place(wf, h.u + h.w, v, lo));
          }
        } else if (h.kind === 'door') {
          if (h.subtype === 'alu') {
            box(h.u, h.v, h.w, h.h, 0.02, wallT * 0.5, glassMat);
            box(h.u, h.v, 0.06, h.h, 0.05, wallT * 0.45, frameWhite);
            box(h.u + h.w - 0.06, h.v, 0.06, h.h, 0.05, wallT * 0.45, frameWhite);
            box(h.u + h.w / 2 - 0.03, h.v, 0.06, h.h, 0.05, wallT * 0.45, frameWhite);
          } else {
            box(h.u, h.v, h.w, h.h, 0.05, wallT * 0.45, cladMat(shade(trimColor, 0.9)));
            box(h.u + h.w - 0.16, h.v + 1.0, 0.1, 0.03, 0.05, wallT * 0.45 + 0.05, cladMat(0xd0d3d6, { metalness: 0.7 }));
          }
        } else {
          box(h.u, h.v, h.w, h.h, 0.02, wallT * 0.5, glassMat);
          const m = 0.05;
          const mull = Math.max(1, Math.round(h.w / (h.subtype === 'vitrage' ? 1.2 : 1.5)));
          for (let i = 0; i <= mull; i++) {
            const x = h.u + (i * (h.w - m)) / mull;
            box(x, h.v, m, h.h, 0.05, wallT * 0.45, frameWhite);
          }
          box(h.u, h.v, h.w, m, 0.05, wallT * 0.45, frameWhite);
          box(h.u, h.v + h.h - m, h.w, m, 0.05, wallT * 0.45, frameWhite);
          if (h.subtype === 'vitrage' && h.h > 2.4) box(h.u, h.v + h.h * 0.72, h.w, m, 0.05, wallT * 0.45, frameWhite);
        }
      }

      // цокольный отлив
      box(u0, 0, u1 - u0, 0.14, 0.035, wallT, trimMat);
    }

    // угловые нащельники
    for (const [x, z] of [
      [-e - wallT, -e - wallT],
      [L + e + wallT, -e - wallT],
      [-e - wallT, B + e + wallT],
      [L + e + wallT, B + e + wallT],
    ]) {
      const h = roofUnder(z < 0 ? 0 : B);
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.16), trimMat);
      c.position.set(x + (x < 0 ? 0.05 : -0.05), h / 2, z + (z < 0 ? 0.05 : -0.05));
      root.add(c);
    }

    const add = (arr: number[], mat: THREE.LineBasicMaterial) => {
      if (!arr.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      root.add(new THREE.LineSegments(g, mat));
    };
    add(seams, seamMat);
    add(gateLines, new THREE.LineBasicMaterial({ color: 0x7c848b, transparent: xray, opacity: xray ? 0.25 : 1 }));
  }

  // ── кровля ──
  if (showClad) {
    const tv = roofT / cos;
    const zl = -ov - (hasWalls ? e + wallT : 0);
    const zr = B + ov + (hasWalls ? e + wallT : 0);
    const yAt = (z: number) => (b.roof === 'mono' ? roofBase + (B - z) * tan : roofBase + (z <= B / 2 ? z : B - z) * tan);
    const pts: [number, number][] = b.roof === 'gable' ? [[zl, yAt(zl)], [B / 2, yAt(B / 2)], [zr, yAt(zr)]] : [[zl, yAt(zl)], [zr, yAt(zr)]];
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (const [z, y] of pts.slice(1)) shape.lineTo(z, y);
    for (const [z, y] of [...pts].reverse()) shape.lineTo(z, y + tv);
    shape.closePath();
    const x0 = -ov - (hasWalls ? e + wallT : 0);
    const x1 = L + ov + (hasWalls ? e + wallT : 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false });
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), up, new THREE.Vector3(1, 0, 0)).setPosition(x0, 0, 0);
    geo.applyMatrix4(m);
    geo.computeVertexNormals();
    const roof = new THREE.Mesh(geo, cladMat(roofColor, { roughness: 0.55 }));
    roof.castShadow = !xray;
    root.add(roof);

    // рёбра кровельных панелей
    const ribs: number[] = [];
    const module = env.roofing === 'proflist' ? 0.25 : 1.0;
    for (let x = x0 + module; x < x1 - 0.05; x += module) {
      for (let i = 0; i < pts.length - 1; i++) {
        ribs.push(x, pts[i][1] + tv + 0.008, pts[i][0], x, pts[i + 1][1] + tv + 0.008, pts[i + 1][0]);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(ribs, 3));
    root.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: shade(roofColor, 0.8), transparent: xray, opacity: xray ? 0.25 : 1 })));

    const trimMat = cladMat(ral(env.trimColor).hex, { roughness: 0.5 });
    if (b.roof === 'gable') {
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.06, 0.5), trimMat);
      ridge.position.set((x0 + x1) / 2, yAt(B / 2) + tv + 0.01, B / 2);
      root.add(ridge);
    }
    if (env.gutters) {
      const sides = b.roof === 'gable' ? [zl, zr] : [zr];
      for (const z of sides) {
        const g = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.11, 0.13), trimMat);
        g.position.set((x0 + x1) / 2, yAt(z) - 0.03, z + (z < B / 2 ? -0.07 : 0.07));
        root.add(g);
        if (hasWalls) {
          const zw = z < B / 2 ? -e - wallT - 0.07 : B + e + wallT + 0.07;
          for (const x of [0.4, L - 0.4]) {
            const hpipe = yAt(z) - 0.1;
            const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, hpipe, 10), trimMat);
            pipe.position.set(x, hpipe / 2, zw);
            root.add(pipe);
          }
        }
      }
    }
  }

  // ── каркас ──
  if (showFrame) {
    const base = STEEL[p.frame.coating] ?? STEEL.primer;
    const metal = p.frame.coating === 'zinc' ? 0.6 : 0.25;
    const tint = (k: number) => new THREE.Color(base).multiplyScalar(k);
    const roleColor: Record<ElementRole, THREE.Color> = {
      column: tint(1),
      truss: tint(1),
      rafter: tint(1),
      purlin: tint(1.25),
      brace: tint(0.72),
      strut: tint(0.85),
      fakhverk: tint(1.12),
      girt: tint(1.25),
      crane: new THREE.Color(0xd9a400),
      floor: tint(0.92),
      opening: tint(1.3),
    };
    // каждая полка и стенка профиля — отдельный параллелепипед
    const boxes: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3; color: THREE.Color }[] = [];
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const el of st.elements) {
      const a = new THREE.Vector3(...el.a);
      const c = new THREE.Vector3(...el.b);
      const dir = c.clone().sub(a);
      const len = dir.length();
      if (len < 0.01) continue;
      dir.normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
      const mid = a.clone().add(c).multiplyScalar(0.5);
      const sec = sectionById(el.sectionId);
      const h = sec.h / 1000;
      const w = sec.b / 1000;
      const longitudinal = Math.abs(dir.x) > 0.9;
      // локальные оси сечения: высота профиля — в плоскости рамы (или вертикально у продольных элементов)
      const hAxis = (longitudinal ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)).applyQuaternion(quat);
      const color = roleColor[el.role];
      const part = (sizeH: number, sizeW: number, offset: number) => {
        const scale = longitudinal ? new THREE.Vector3(sizeH, len, sizeW) : new THREE.Vector3(sizeW, len, sizeH);
        boxes.push({ pos: mid.clone().addScaledVector(hAxis, offset), quat, scale, color });
      };
      if (sec.family === 'tube') {
        part(h, w, 0);
      } else if (sec.family === 'ibeam') {
        const tf = sec.tf / 1000;
        part(tf, w, (h - tf) / 2);
        part(tf, w, -(h - tf) / 2);
        part(h - 2 * tf, Math.max(0.012, sec.tw / 1000), 0);
      } else {
        const tf = sec.tf / 1000;
        part(tf, w, (h - tf) / 2);
        part(tf, w, -(h - tf) / 2);
        part(h - 2 * tf, Math.max(0.012, sec.tw / 1000), 0);
      }
    }
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: metal }),
      boxes.length,
    );
    const mtx = new THREE.Matrix4();
    boxes.forEach((bx, i) => {
      mtx.compose(bx.pos, bx.quat, bx.scale);
      inst.setMatrixAt(i, mtx);
      inst.setColorAt(i, bx.color);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = mode === 'frame';
    inst.frustumCulled = false;
    root.add(inst);

    // плиты перекрытий
    if (b.floors > 1) {
      const fl = Math.min(L, b.floorLength ?? L);
      const hf = b.height / b.floors;
      const mat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.9, transparent: true, opacity: 0.85 });
      for (let k = 1; k < b.floors; k++) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(fl, 0.14, B), mat);
        slab.position.set(fl / 2, k * hf + 0.22, B / 2);
        slab.receiveShadow = true;
        root.add(slab);
      }
    }
  }

  return root;
}

/** Модель всего здания: основной блок и пристройки, каждая в своём положении на плане */
export function buildScene(p: Project, calc: CalcResult, mode: ViewMode, theme: SceneTheme): THREE.Group {
  const root = new THREE.Group();
  const [x0, z0, x1, z1] = calc.totals.bounds;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(x1 - x0, z1 - z0) * 4 + 30, 64),
    new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((x0 + x1) / 2, -0.07, (z0 + z1) / 2);
  ground.receiveShadow = true;
  root.add(ground);
  calc.blocks.forEach((blk, i) => {
    const g = buildBlock(blk.project, blk, mode, theme, i === 0);
    const { origin, ex, ez } = blk.placement;
    g.matrixAutoUpdate = false;
    g.matrix.makeBasis(new THREE.Vector3(ex[0], 0, ex[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(ez[0], 0, ez[1])).setPosition(origin[0], 0, origin[1]);
    root.add(g);
  });
  void p;
  root.position.set(-(x0 + x1) / 2, 0, -(z0 + z1) / 2);
  return root;
}

export function disposeGroup(group: THREE.Object3D): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

export type ViewPreset = 'iso' | 'front' | 'side' | 'top' | 'back';

/** Положение камеры для заданного вида: здание целиком в кадре */
export function cameraFor(p: Project, calc: CalcResult, view: ViewPreset, aspect: number, fovDeg: number): { position: THREE.Vector3; target: THREE.Vector3 } {
  void p;
  const [bx0, bz0, bx1, bz1] = calc.totals.bounds;
  const L = bx1 - bx0;
  const B = bz1 - bz0;
  const H = calc.totals.height;
  const target = new THREE.Vector3(0, H * 0.42, 0);
  const dirs: Record<ViewPreset, THREE.Vector3> = {
    iso: new THREE.Vector3(-0.9, 0.5, -1.15),
    back: new THREE.Vector3(0.9, 0.5, 1.15),
    front: new THREE.Vector3(-1, 0.12, 0),
    side: new THREE.Vector3(0, 0.12, -1),
    top: new THREE.Vector3(-0.001, 1, -0.001),
  };
  const dir = dirs[view].clone().normalize();
  // радиус сферы, описанной вокруг здания
  const r = Math.hypot(L, B, H) / 2;
  const fov = (fovDeg * Math.PI) / 180;
  const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect));
  const dist = (r / Math.sin(fit / 2)) * (view === 'iso' || view === 'back' ? 0.8 : 0.92);
  return { position: target.clone().addScaledVector(dir, dist), target };
}

export function addLights(scene: THREE.Scene, p: Project, calc: CalcResult): void {
  void p;
  const [bx0, bz0, bx1, bz1] = calc.totals.bounds;
  const L = bx1 - bx0;
  const B = bz1 - bz0;
  const H = calc.totals.height;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa4acb3, 1.9));
  const sun = new THREE.DirectionalLight(0xfff8ee, 2.6);
  const r = Math.hypot(L, B, H) / 2 + 4;
  sun.position.set(-r * 0.9, r * 1.6, -r * 1.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -r * 2.4;
  cam.right = r * 2.4;
  cam.top = r * 2.4;
  cam.bottom = -r * 2.4;
  cam.near = 0.5;
  cam.far = r * 8;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
}
