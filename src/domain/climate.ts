// Климатические параметры населённых пунктов регионов, где работает компания.
// Значения — исходные данные для расчёта нагрузок, поэтому каждое можно поправить в расчёте.

export interface Settlement {
  id: string;
  name: string;
  region: string;
  /** снеговой район по карте 1 прил. Е СП 20.13330.2016 */
  snow: number;
  /** Sg по табл. К.1 СП 20.13330.2016, если город в ней есть, кПа */
  sg: number | null;
  /** ветровой район по карте 2 прил. Е */
  wind: string;
  /** отопительный период (≤ 8 °C) по СП 131.13330: средняя температура и длительность */
  tHeat: number;
  zHeat: number;
  /** нормативная глубина промерзания суглинков и глин, м */
  frost: number;
  /** значение требует уточнения по картам СП 20 */
  check?: boolean;
}

export const REGIONS = [
  'Санкт-Петербург',
  'Ленинградская область',
  'Псковская область',
  'Новгородская область',
  'Республика Карелия',
  'Вологодская область',
  'Мурманская область',
];

function s(
  name: string,
  region: string,
  snow: number,
  sg: number | null,
  wind: string,
  tHeat: number,
  zHeat: number,
  frost: number,
  check = false,
): Settlement {
  return { id: name, name, region, snow, sg, wind, tHeat, zHeat, frost, check };
}

// ПРЕДВАРИТЕЛЬНЫЕ ДАННЫЕ — заменяются выверенной таблицей.
export const SETTLEMENTS: Settlement[] = [s('Санкт-Петербург', 'Санкт-Петербург', 3, null, 'II', -1.2, 213, 1.2, true)];

export const DEFAULT_SETTLEMENT = 'Санкт-Петербург';

export function settlementById(id: string): Settlement | undefined {
  return SETTLEMENTS.find((x) => x.id === id);
}
