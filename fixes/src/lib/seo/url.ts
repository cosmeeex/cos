/**
 * Единая сборка URL каталога, брендов и пагинации.
 *
 * Закрывает P2-8 из docs/seo-audit.md: на одной странице каталога
 * 25 ссылок кодировали `sub=` через %20, а 24 — через `+`. Canonical
 * нормализует к `+`, поэтому половина внутренних ссылок вела на
 * неканонический адрес и тратила краулинговый бюджет на лишний хоп.
 *
 * Причина расхождения — два способа сборки в разных местах кода:
 * URLSearchParams кодирует пробел как `+`, encodeURIComponent — как `%20`.
 * Здесь единственный источник истины: всё идёт через URLSearchParams.
 *
 * Все ссылки — включая item в BreadcrumbList JSON-LD, где сейчас везде
 * %20, — должны строиться этими функциями.
 */

/** Порядок параметров в строке запроса. Не алфавитный: совпадает с тем,
 *  что уже отдаёт canonical на продакшене (`?sub=…&page=2`). Параметры вне
 *  списка идут после, отсортированные по алфавиту — чтобы один и тот же
 *  набор всегда давал побайтово одинаковый URL. */
const PARAM_ORDER = ['sub', 'page'] as const

export type QueryValue = string | number | undefined | null

/** Значения, которые не должны попадать в URL: пустые и «первая страница». */
function isOmitted(key: string, value: QueryValue): boolean {
  if (value === undefined || value === null || value === '') return true
  // ?page=1 эквивалентен адресу без параметра и редиректится 301-м.
  // Не создаём лишний хоп на ровном месте.
  if (key === 'page' && Number(value) === 1) return true
  return false
}

export function buildQuery(params: Record<string, QueryValue>): string {
  const entries = Object.entries(params).filter(([k, v]) => !isOmitted(k, v))

  entries.sort(([a], [b]) => {
    const ia = PARAM_ORDER.indexOf(a as (typeof PARAM_ORDER)[number])
    const ib = PARAM_ORDER.indexOf(b as (typeof PARAM_ORDER)[number])
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })

  const qs = new URLSearchParams()
  for (const [k, v] of entries) qs.set(k, String(v))
  return qs.toString()
}

function withQuery(path: string, params: Record<string, QueryValue>): string {
  const qs = buildQuery(params)
  return qs ? `${path}?${qs}` : path
}

export function buildCatalogUrl(
  slug: string | undefined,
  params: Record<string, QueryValue> = {},
): string {
  return withQuery(slug ? `/catalog/${slug}` : '/catalog', params)
}

export function buildBrandUrl(
  slug: string,
  params: Record<string, QueryValue> = {},
): string {
  return withQuery(`/brand/${slug}`, params)
}

/**
 * Пагинация строится ОТ ТЕКУЩЕГО ПУТИ, а не от канонического адреса
 * родительской категории.
 *
 * Закрывает P1-6: сейчас на ЧПУ-лендинге /catalog/gel-laki ссылки
 * пагинации ведут на /catalog/dlya-manikyura-i-pedikyura?page=2&sub=…,
 * то есть страница 1 коллекции живёт на красивом адресе, а страницы
 * 2–10 — на длинном параметрическом. Внутренний вес расщепляется
 * между двумя URL одной коллекции.
 */
export function buildPageUrl(
  pathname: string,
  currentParams: Record<string, QueryValue>,
  page: number,
): string {
  return withQuery(pathname, { ...currentParams, page })
}

/** Абсолютный URL для canonical, og:url, JSON-LD и sitemap. */
export const SITE_ORIGIN = 'https://cosmex.ru'

export function absolute(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl
  return `${SITE_ORIGIN}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
}
