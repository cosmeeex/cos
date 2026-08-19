/**
 * Сопоставление бренда из учётной системы с посадочной страницей.
 *
 * Закрывает P1-5 и часть P1-7 из docs/seo-audit.md.
 *
 * На одной странице /catalog/gel-laki — 54 ссылки (32 уникальных)
 * на URL, закрытые в robots.txt:
 *
 *   /catalog/dlya-manikyura-i-pedikyura?sub=…&brand=ADRICOCO  ← Disallow: /*?*brand=
 *   /catalog?search=CosmoLac (×15)                            ← Disallow: /*?*search=
 *   /catalog?search=ADRICOCO (×8)                             ← Disallow: /*?*search=
 *
 * При этом /brand/cosmolac отдаёт 200 и полностью пригоден к
 * ранжированию: Brand + ItemList + FAQPage + BreadcrumbList,
 * осмысленные title и H1. То есть вес внутренних ссылок уходит
 * в заглушки мимо готовых посадочных.
 */

/** Бренды, у которых уже есть страница /brand/{slug} (проверено: все 200). */
export const BRAND_LANDINGS: Record<string, string> = {
  staleks: 'staleks',
  kira: 'kira',
  lovely: 'lovely',
  cosmolac: 'cosmolac',
  adricoco: 'adricoco',
  'planet nails': 'planet-nails',
  milv: 'milv',
  prozatochka: 'prozatochka',
  boheme: 'boheme',
}

/** Нормализует название бренда из МойСклад в ключ поиска. */
export function brandKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/gu, ' ')
}

/** Возвращает slug посадочной страницы бренда или null, если её ещё нет. */
export function brandLandingSlug(name: string): string | null {
  return BRAND_LANDINGS[brandKey(name)] ?? null
}

/**
 * Бренды, встреченные в фильтрах каталога, но без посадочной страницы.
 * Список собран с одной категории (/catalog/gel-laki) — по всему каталогу
 * их больше. Это готовая очередь работ из docs/growth-plan.md, п. 2.
 */
export const BRANDS_WITHOUT_LANDING = [
  'BORN PRETTY',
  'BSG',
  'BlueSky',
  'COSMEX',
  'Emi',
  'Grattol',
  'InGarden',
  'LiANAiL',
  'Patrisa Nail',
  'UNO',
  'Инструменты красоты',
  'Луи Филипп',
  'Опция',
] as const
