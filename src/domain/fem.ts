// Расчёт плоской стержневой системы методом перемещений (МКЭ).
// Узел имеет три степени свободы: ux, uy, поворот. Стержень работает на растяжение-сжатие
// и изгиб; на любом конце можно поставить шарнир. Единицы: кН, м.
//
// Знаки внутренних усилий: N > 0 — растяжение; M > 0 — растянуто волокно со стороны
// отрицательной локальной оси y (для горизонтального стержня слева направо — нижнее).

export interface FemNode {
  x: number;
  y: number;
  /** закрепления по ux, uy, повороту */
  fix?: [boolean, boolean, boolean];
}

export interface FemElem {
  n1: number;
  n2: number;
  /** жёсткости: EA, кН; EI, кН·м² */
  EA: number;
  EI: number;
  /** шарниры по концам */
  rel1?: boolean;
  rel2?: boolean;
}

export interface NodalLoad {
  node: number;
  fx: number;
  fy: number;
  mz: number;
}

/** Равномерная нагрузка на стержень в глобальных осях, кН на метр длины стержня */
export interface DistLoad {
  elem: number;
  qx: number;
  qy: number;
}

export interface LoadCase {
  nodal: NodalLoad[];
  dist: DistLoad[];
}

export interface ElemForces {
  /** локальные компоненты нагрузки на стержень */
  qxl: number;
  qyl: number;
  /** усилия, с которыми узлы действуют на концы стержня (локальные оси) */
  f: [number, number, number, number, number, number];
  L: number;
}

export interface CaseResult {
  /** перемещения узлов: [ux, uy, rz] на узел */
  disp: Float64Array;
  elems: ElemForces[];
  /** реакции в закреплённых степенях свободы, по узлам */
  reactions: Float64Array;
}

export interface Station {
  N: number;
  Q: number;
  M: number;
}

/** Внутренние усилия в сечении на расстоянии x от начала стержня */
export function forcesAt(e: ElemForces, x: number): Station {
  return {
    N: -e.f[0] - e.qxl * x,
    Q: e.f[1] + e.qyl * x,
    M: -e.f[2] + e.f[1] * x + (e.qyl * x * x) / 2,
  };
}

interface ElemData {
  c: number;
  s: number;
  L: number;
  /** локальная матрица жёсткости 6×6 с учётом шарниров */
  k: number[][];
  dofs: number[];
}

function localStiffness(EA: number, EI: number, L: number): number[][] {
  const a = EA / L;
  const b = (12 * EI) / L ** 3;
  const c = (6 * EI) / L ** 2;
  const d = (4 * EI) / L;
  const e = (2 * EI) / L;
  return [
    [a, 0, 0, -a, 0, 0],
    [0, b, c, 0, -b, c],
    [0, c, d, 0, -c, e],
    [-a, 0, 0, a, 0, 0],
    [0, -b, -c, 0, b, -c],
    [0, c, e, 0, -c, d],
  ];
}

/** Статическая конденсация степени свободы r (шарнир): матрица и вектор узловых сил */
function condense(k: number[][], f: number[] | null, r: number): void {
  const krr = k[r][r];
  if (Math.abs(krr) < 1e-30) return;
  const col = k.map((row) => row[r]);
  if (f) {
    const fr = f[r];
    for (let i = 0; i < 6; i++) f[i] -= (col[i] * fr) / krr;
    f[r] = 0;
  }
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) k[i][j] -= (col[i] * k[r][j]) / krr;
  }
  // после вычитания строка и столбец r обнуляются
  for (let i = 0; i < 6; i++) {
    k[r][i] = 0;
    k[i][r] = 0;
  }
}

export class FemModel {
  private data: ElemData[] = [];
  private free: number[] = [];
  private freeIndex: Int32Array;
  /** нижний треугольник разложения Холецкого по свободным степеням свободы */
  private chol: Float64Array;
  private nFree = 0;
  private ndof: number;
  private kGlobal: Float64Array;

  constructor(
    readonly nodes: FemNode[],
    readonly elems: FemElem[],
  ) {
    this.ndof = nodes.length * 3;
    const K = new Float64Array(this.ndof * this.ndof);
    for (const el of elems) {
      const p1 = nodes[el.n1];
      const p2 = nodes[el.n2];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const L = Math.hypot(dx, dy);
      if (L < 1e-9) throw new Error('Стержень нулевой длины');
      const c = dx / L;
      const s = dy / L;
      const k = localStiffness(el.EA, el.EI, L);
      if (el.rel1 && el.rel2) {
        // ферменный стержень: только осевая жёсткость
        for (const i of [1, 2, 4, 5]) for (let j = 0; j < 6; j++) (k[i][j] = 0), (k[j][i] = 0);
      } else {
        if (el.rel1) condense(k, null, 2);
        if (el.rel2) condense(k, null, 5);
      }
      const dofs = [el.n1 * 3, el.n1 * 3 + 1, el.n1 * 3 + 2, el.n2 * 3, el.n2 * 3 + 1, el.n2 * 3 + 2];
      this.data.push({ c, s, L, k, dofs });
      const kg = toGlobal(k, c, s);
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) K[dofs[i] * this.ndof + dofs[j]] += kg[i][j];
      }
    }
    this.kGlobal = K;

    // свободные степени свободы; поворот узла, в который сходятся только шарниры, закрепляем
    let maxDiag = 0;
    for (let i = 0; i < this.ndof; i++) maxDiag = Math.max(maxDiag, K[i * this.ndof + i]);
    this.freeIndex = new Int32Array(this.ndof).fill(-1);
    for (let n = 0; n < nodes.length; n++) {
      const fix = nodes[n].fix;
      for (let d = 0; d < 3; d++) {
        const i = n * 3 + d;
        const fixed = fix ? fix[d] : false;
        const dead = K[i * this.ndof + i] < maxDiag * 1e-14;
        if (!fixed && !dead) {
          this.freeIndex[i] = this.free.length;
          this.free.push(i);
        }
      }
    }
    this.nFree = this.free.length;
    this.chol = this.factor();
  }

  private factor(): Float64Array {
    const n = this.nFree;
    const A = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      const gi = this.free[i];
      for (let j = 0; j <= i; j++) A[i * n + j] = this.kGlobal[gi * this.ndof + this.free[j]];
    }
    let scale = 0;
    for (let i = 0; i < n; i++) scale = Math.max(scale, A[i * n + i]);
    for (let j = 0; j < n; j++) {
      let d = A[j * n + j];
      for (let k = 0; k < j; k++) d -= A[j * n + k] * A[j * n + k];
      if (d <= scale * 1e-12) {
        throw new Error('Система геометрически изменяема: проверьте связи и опоры');
      }
      const ljj = Math.sqrt(d);
      A[j * n + j] = ljj;
      for (let i = j + 1; i < n; i++) {
        let v = A[i * n + j];
        for (let k = 0; k < j; k++) v -= A[i * n + k] * A[j * n + k];
        A[i * n + j] = v / ljj;
      }
    }
    return A;
  }

  private solveFree(rhs: Float64Array): Float64Array {
    const n = this.nFree;
    const L = this.chol;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let v = rhs[i];
      for (let k = 0; k < i; k++) v -= L[i * n + k] * y[k];
      y[i] = v / L[i * n + i];
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let v = y[i];
      for (let k = i + 1; k < n; k++) v -= L[k * n + i] * x[k];
      x[i] = v / L[i * n + i];
    }
    return x;
  }

  /** Узловые силы от распределённой нагрузки в локальных осях (с учётом шарниров) */
  private equivalent(idx: number, qxl: number, qyl: number): number[] {
    const d = this.data[idx];
    const el = this.elems[idx];
    const L = d.L;
    const f = [(qxl * L) / 2, (qyl * L) / 2, (qyl * L * L) / 12, (qxl * L) / 2, (qyl * L) / 2, (-qyl * L * L) / 12];
    if (el.rel1 || el.rel2) {
      if (el.rel1 && el.rel2) {
        f[2] = 0;
        f[5] = 0;
      } else {
        const k = localStiffness(el.EA, el.EI, L);
        if (el.rel1) condense(k, f, 2);
        if (el.rel2) condense(k, f, 5);
      }
    }
    return f;
  }

  solve(lc: LoadCase): CaseResult {
    const F = new Float64Array(this.ndof);
    for (const p of lc.nodal) {
      F[p.node * 3] += p.fx;
      F[p.node * 3 + 1] += p.fy;
      F[p.node * 3 + 2] += p.mz;
    }
    const qByElem = new Map<number, { qxl: number; qyl: number }>();
    for (const q of lc.dist) {
      const d = this.data[q.elem];
      const prev = qByElem.get(q.elem) ?? { qxl: 0, qyl: 0 };
      prev.qxl += q.qx * d.c + q.qy * d.s;
      prev.qyl += -q.qx * d.s + q.qy * d.c;
      qByElem.set(q.elem, prev);
    }
    const eqLocal = new Map<number, number[]>();
    for (const [idx, q] of qByElem) {
      const d = this.data[idx];
      const fl = this.equivalent(idx, q.qxl, q.qyl);
      eqLocal.set(idx, fl);
      const fg = vecToGlobal(fl, d.c, d.s);
      for (let i = 0; i < 6; i++) F[d.dofs[i]] += fg[i];
    }

    const rhs = new Float64Array(this.nFree);
    for (let i = 0; i < this.nFree; i++) rhs[i] = F[this.free[i]];
    const u = this.solveFree(rhs);
    const disp = new Float64Array(this.ndof);
    for (let i = 0; i < this.nFree; i++) disp[this.free[i]] = u[i];

    const elems: ElemForces[] = this.data.map((d, idx) => {
      const ug = d.dofs.map((g) => disp[g]);
      const ul = vecToLocal(ug, d.c, d.s);
      const f = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) {
        let v = 0;
        for (let j = 0; j < 6; j++) v += d.k[i][j] * ul[j];
        f[i] = v;
      }
      const eq = eqLocal.get(idx);
      if (eq) for (let i = 0; i < 6; i++) f[i] -= eq[i];
      const q = qByElem.get(idx);
      return {
        qxl: q?.qxl ?? 0,
        qyl: q?.qyl ?? 0,
        f: f as ElemForces['f'],
        L: d.L,
      };
    });

    // реакции: R = K·u − F в закреплённых степенях свободы
    const reactions = new Float64Array(this.ndof);
    for (let n = 0; n < this.nodes.length; n++) {
      const fix = this.nodes[n].fix;
      if (!fix) continue;
      for (let dd = 0; dd < 3; dd++) {
        if (!fix[dd]) continue;
        const i = n * 3 + dd;
        let v = -F[i];
        for (let j = 0; j < this.nFree; j++) v += this.kGlobal[i * this.ndof + this.free[j]] * u[j];
        reactions[i] = v;
      }
    }
    return { disp, elems, reactions };
  }
}

function toGlobal(k: number[][], c: number, s: number): number[][] {
  // T — матрица перехода от глобальных к локальным: ul = T·ug; Kg = Tᵀ·k·T
  const T = rot(c, s);
  const tmp = mul(k, T);
  return mul(transpose(T), tmp);
}

function rot(c: number, s: number): number[][] {
  return [
    [c, s, 0, 0, 0, 0],
    [-s, c, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 0, c, s, 0],
    [0, 0, 0, -s, c, 0],
    [0, 0, 0, 0, 0, 1],
  ];
}

function mul(a: number[][], b: number[][]): number[][] {
  const r: number[][] = [];
  for (let i = 0; i < 6; i++) {
    r.push([]);
    for (let j = 0; j < 6; j++) {
      let v = 0;
      for (let k = 0; k < 6; k++) v += a[i][k] * b[k][j];
      r[i].push(v);
    }
  }
  return r;
}

function transpose(a: number[][]): number[][] {
  return a[0].map((_, j) => a.map((row) => row[j]));
}

function vecToLocal(v: number[], c: number, s: number): number[] {
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2], c * v[3] + s * v[4], -s * v[3] + c * v[4], v[5]];
}

function vecToGlobal(v: number[], c: number, s: number): number[] {
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2], c * v[3] - s * v[4], s * v[3] + c * v[4], v[5]];
}
