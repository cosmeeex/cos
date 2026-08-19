/**
 * Образец страницы категории со всеми исправлениями каталога.
 *
 * Закрывает P0-2 (бесконечная пагинация) и показывает, куда встают
 * resolvePage / buildCatalogUrl / paginationRelLinks. Путь файла в проекте:
 * app/catalog/[slug]/page.tsx. Здесь он назван иначе, чтобы этот каталог
 * с патчами не пытались собрать как приложение.
 *
 * Точно так же правится /brand/[slug] — там та же пагинация.
 */

import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CatalogPagination } from '@/components/CatalogPagination'
import { absolute, buildCatalogUrl } from '@/lib/seo/url'
import { DEFAULT_PER_PAGE, paginationRelLinks, resolvePage } from '@/lib/seo/pagination'

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

declare function getProducts(args: {
  slug: string
  page: number
  perPage: number
  sub?: string
}): Promise<{ items: unknown[]; total: number }>
declare function getCategory(slug: string): Promise<{ title: string; description: string; h1: string } | null>

/** Единственный параметр фильтрации, который мы индексируем. */
function subOf(sp: Record<string, string | string[] | undefined>): string | undefined {
  const v = Array.isArray(sp.sub) ? sp.sub[0] : sp.sub
  return v || undefined
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params
  const sp = await searchParams
  const sub = subOf(sp)

  const category = await getCategory(slug)
  if (!category) return {}

  const { total } = await getProducts({ slug, page: 1, perPage: DEFAULT_PER_PAGE, sub })
  const resolution = resolvePage({ raw: sp.page, total })
  const { page, lastPage } = resolution

  // Пагинация в canonical и rel-ссылках строится тем же билдером,
  // что и разметка, — единое кодирование `sub=` (P2-8).
  const urlFor = (n: number) => absolute(buildCatalogUrl(slug, { sub, page: n }))

  const { prev, next } = paginationRelLinks({ page, lastPage, buildUrl: urlFor })

  return {
    title: page > 1 ? `${category.title} — страница ${page}` : category.title,
    description: category.description,
    alternates: { canonical: urlFor(page) },
    robots: { index: true, follow: true },
    // rel=prev/rel=next: Google их не использует, Яндекс — учитывает.
    other: { ...(prev && { prev }), ...(next && { next }) },
  }
}

export default async function CatalogCategoryPage({ params, searchParams }: Props) {
  const { slug } = await params
  const sp = await searchParams
  const sub = subOf(sp)

  const category = await getCategory(slug)
  if (!category) notFound()

  // total нужен до решения по странице — верхнюю границу иначе не узнать.
  const first = await getProducts({ slug, page: 1, perPage: DEFAULT_PER_PAGE, sub })
  const resolution = resolvePage({ raw: sp.page, total: first.total })

  // ?page=1, ?page=0, ?page=abc, ?page=-5 — дубли базового URL.
  // 301 дешевле для краулингового бюджета, чем 200 + canonical.
  if (resolution.kind === 'redirect') {
    redirect(buildCatalogUrl(slug, { sub }))
  }

  // ── Ключевое исправление P0-2 ────────────────────────────────────────
  // Страница за пределом диапазона — честный 404, а не пустой 200
  // с index,follow и self-canonical.
  if (resolution.kind === 'notFound') {
    notFound()
  }
  // ─────────────────────────────────────────────────────────────────────

  const { page, lastPage } = resolution
  const { items } =
    page === 1 ? first : await getProducts({ slug, page, perPage: DEFAULT_PER_PAGE, sub })

  return (
    <>
      <h1>{category.h1}</h1>
      <ProductGrid items={items} />
      <CatalogPagination page={page} lastPage={lastPage} />
    </>
  )
}

declare function ProductGrid(props: { items: unknown[] }): JSX.Element
