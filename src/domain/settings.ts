// Общие настройки модуля: юрлица, справочник цен, оформление КП.

import { DEFAULT_PRICES, mergePrices } from './prices';
import type { LegalEntity, Settings } from './types';

export const VAT_OPTIONS = [
  { label: 'НДС 22% (общая система)', vatMode: 'included', vatRate: 22 },
  { label: 'НДС 7% (упрощённая система)', vatMode: 'included', vatRate: 7 },
  { label: 'НДС 5% (упрощённая система)', vatMode: 'included', vatRate: 5 },
  { label: 'Без НДС (упрощённая система)', vatMode: 'none', vatRate: 0 },
] as const;

export function vatLabel(e: Pick<LegalEntity, 'vatMode' | 'vatRate'> | undefined): string {
  if (!e || e.vatMode === 'none') return 'НДС не облагается';
  return `в том числе НДС ${e.vatRate}%`;
}

export function defaultSettings(): Settings {
  return {
    brand: 'Строим для Вас',
    slogan: 'Здания из металлокаркаса и сэндвич-панелей',
    site: '',
    logo: '',
    entities: [
      {
        id: 'osn',
        name: 'ООО «Строим для Вас»',
        inn: '',
        kpp: '',
        address: '',
        phone: '',
        email: '',
        bank: '',
        vatMode: 'included',
        vatRate: 22,
      },
      {
        id: 'usn',
        name: 'ООО «Строим для Вас» (УСН)',
        inn: '',
        kpp: '',
        address: '',
        phone: '',
        email: '',
        bank: '',
        vatMode: 'none',
        vatRate: 0,
      },
    ],
    prices: DEFAULT_PRICES.map((p) => ({ ...p })),
  };
}

/** Привести сохранённые настройки к текущей версии: добавить новые позиции цен и поля */
export function normalizeSettings(saved: Partial<Settings> | null | undefined): Settings {
  const d = defaultSettings();
  if (!saved) return d;
  return {
    brand: saved.brand ?? d.brand,
    slogan: saved.slogan ?? d.slogan,
    site: saved.site ?? d.site,
    logo: saved.logo ?? '',
    entities: saved.entities?.length ? saved.entities : d.entities,
    prices: mergePrices(saved.prices),
  };
}
