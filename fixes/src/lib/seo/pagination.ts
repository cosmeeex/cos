/**
 * Разбор и валидация параметра ?page=.
 *
 * Закрывает P0-2 из docs/seo-audit.md.
 *
 * Замер на продакшене (/catalog/produktsiya-cosmex):
 *
 *   page=1      301 → базовый URL                              ✅
 *   page=2      200, 30 товаров, self-canonical                ✅
 *   page=50     200, 0 товаров, index,follow, self-canonical   ❌
 *   page=999    200, 0 товаров, index,follow, self-canonical   ❌
 *   page=99999  200, 0 товаров, index,follow, self-canonical   ❌
 *   page=1e9    200, 0 товаров, index,follow, self-canonical   ❌
 *   page=0      200, 30 товаров, canonical → базовый           ✅
 *   page=-5     200, 30 товаров, canonical → базовый           ✅
 *   page=abc    200, 30 товаров, canonical → базовый           ✅
 *
 * Невалидные значения обработаны верно. Проблема ровно одна: страница
 * ЗА ПРЕДЕЛОМ ДИАПАЗОНА отдаёт 200 с пустым списком и разрешает себя
 * индексировать. Это генератор soft-404 неограниченного объёма:
 * ?page= не закрыт в robots.txt и умножается на 35 категорий и
 * 19 вариантов ?sub=.
 */

export const DEFAULT_PER_PAGE = 30

/**
 * Приводит сырое значение ?page= к целому числу ≥ 1.
 *
 * Всё, что не является целым положительным числом ('abc', '0', '-5',
 * '2.5', '1e9', массив из повторяющегося параметра), считается первой
 * страницей. Именно так ведёт себя текущий canonical — сохраняем поведение.
 *
 * Отдельно про '1e9': Number('1e9') === 1000000000 и проходит проверку
 * на целое, поэтому строка отсеивается до приведения к числу.
 */
export function normalizePage(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' && typeof value !== 'number') return 1

  const str = String(value).trim()
  // Только десятичная запись без знака, экспоненты и дробной части.
  if (!/^\d+$/.test(str)) return 1

  const n = Number(str)
  if (!Number.isSafeInteger(n) || n < 1) return 1
  return n
}

export function lastPageOf(total: number, perPage: number = DEFAULT_PER_PAGE): number {
  if (!Number.isFinite(total) || total <= 0) return 1
  return Math.max(1, Math.ceil(total / perPage))
}

export type PageResolution =
  /** Отдаём страницу. */
  | { kind: 'ok'; page: number; lastPage: number }
  /** Параметр лишний или невалидный — 301 на адрес без ?page=. */
  | { kind: 'redirect'; page: 1; lastPage: number }
  /** Страницы не существует — notFound(), честный HTTP 404. */
  | { kind: 'notFound'; page: number; lastPage: number }

/**
 * Решает, что делать с запрошенной страницей.
 *
 * Вызывается ПОСЛЕ получения total, потому что верхнюю границу нельзя
 * узнать заранее. Порядок веток важен: сначала лишний параметр (301),
 * потом выход за диапазон (404).
 */
export function resolvePage(args: {
  raw: unknown
  total: number
  perPage?: number
}): PageResolution {
  const { raw, total, perPage = DEFAULT_PER_PAGE } = args
  const lastPage = lastPageOf(total, perPage)
  const page = normalizePage(raw)

  // Параметр присутствует, но схлопывается в первую страницу
  // ('?page=1', '?page=abc', '?page=0', '?page=-5') — это дубль
  // базового URL. Убираем параметр редиректом, а не canonical-ом:
  // 301 дешевле для краулингового бюджета, чем 200 + canonical.
  const hasParam = raw !== undefined && raw !== null && raw !== ''
  if (hasParam && page === 1) return { kind: 'redirect', page: 1, lastPage }

  // Ключевое исправление: за пределом диапазона — 404, а не пустой 200.
  if (page > lastPage) return { kind: 'notFound', page, lastPage }

  return { kind: 'ok', page, lastPage }
}

/**
 * rel=prev / rel=next.
 *
 * Google не использует их с 2019 года, Яндекс — учитывает.
 * prev со второй страницы ведёт на базовый URL без ?page=1,
 * иначе снова появляется дубль, который редиректится 301-м.
 */
export function paginationRelLinks(args: {
  page: number
  lastPage: number
  buildUrl: (page: number) => string
}): { prev?: string; next?: string } {
  const { page, lastPage, buildUrl } = args
  const links: { prev?: string; next?: string } = {}
  if (page > 1) links.prev = buildUrl(page - 1)
  if (page < lastPage) links.next = buildUrl(page + 1)
  return links
}
