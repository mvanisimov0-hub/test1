// Форматирование чисел и дат для интерфейса и документов.

export function nf(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

/** Число без лишних нулей: 6 → «6», 4,5 → «4,5» */
export function num(v: number, maxDigits = 2): string {
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: maxDigits }).format(v);
}

export function rub(v: number): string {
  return `${nf(Math.round(v))} ₽`;
}

/** Крупные суммы: 18,3 млн ₽ */
export function rubShort(v: number): string {
  if (Math.abs(v) >= 1e6) return `${nf(v / 1e6, 2)} млн ₽`;
  if (Math.abs(v) >= 1e3) return `${nf(v / 1e3, 0)} тыс. ₽`;
  return rub(v);
}

export function dateRu(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function dateTimeRu(iso: string): string {
  const d = new Date(iso);
  return `${dateRu(d)} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export const TECH_LABEL = { welded: 'Сварной каркас', kmd: 'Каркас по КМ/КМД' } as const;
export const SCHEME_LABEL = { beam: 'рамы с ригелем сплошного сечения', truss: 'стропильные фермы' } as const;
