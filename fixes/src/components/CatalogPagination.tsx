'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { buildPageUrl } from '@/lib/seo/url'

/**
 * Пагинация каталога.
 *
 * Закрывает P1-6: сейчас на ЧПУ-лендинге /catalog/gel-laki ссылки
 * пагинации ведут на ДРУГОЙ адрес —
 * /catalog/dlya-manikyura-i-pedikyura?page=2&sub=Гель-лаки…
 * Страница 1 коллекции живёт на красивом URL, страницы 2–10 — на
 * длинном параметрическом. Краулер видит лендинг тупиком из 30 товаров,
 * а остальные 270 привязываются к другому адресу.
 *
 * Исправление: ссылки строятся от usePathname(), то есть от того пути,
 * по которому пользователь и краулер пришли, а не от канонического
 * адреса родительской категории.
 *
 * Заодно закрывает часть P0-2: ссылка на первую страницу отдаётся без
 * ?page=1, иначе каждая такая ссылка — лишний 301-хоп для краулера.
 */
export function CatalogPagination({ page, lastPage }: { page: number; lastPage: number }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  if (lastPage <= 1) return null

  const params: Record<string, string> = {}
  for (const [k, v] of searchParams.entries()) {
    if (k !== 'page') params[k] = v
  }

  // buildPageUrl сам опускает page=1 — отдельной ветки не нужно.
  const hrefFor = (n: number) => buildPageUrl(pathname, params, n)

  return (
    <nav aria-label="Страницы каталога">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} rel="prev">
          Предыдущая
        </Link>
      )}

      {pageWindow(page, lastPage).map((n) =>
        n === page ? (
          <span key={n} aria-current="page">
            {n}
          </span>
        ) : (
          <Link key={n} href={hrefFor(n)}>
            {n}
          </Link>
        ),
      )}

      {page < lastPage && (
        <Link href={hrefFor(page + 1)} rel="next">
          Следующая
        </Link>
      )}
    </nav>
  )
}

/** Окно номеров вокруг текущей страницы: 1 … 4 5 [6] 7 8 … 20 */
export function pageWindow(page: number, lastPage: number, radius = 2): number[] {
  const pages = new Set<number>([1, lastPage])
  for (let n = page - radius; n <= page + radius; n++) {
    if (n >= 1 && n <= lastPage) pages.add(n)
  }
  return [...pages].sort((a, b) => a - b)
}
