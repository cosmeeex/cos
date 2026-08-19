import type { MetadataRoute } from 'next'
import { absolute } from '@/lib/seo/url'

/**
 * sitemap.xml.
 *
 * Закрывает P2-9 и правки из fixes/next/sitemap.md.
 *
 * Что было в замере 18.08.2026: 6 524 URL, 1,54 МБ, дублей нет,
 * лимиты Google (50 000 / 50 МБ) не нарушены. Правки точечные:
 *
 *   1. /catalog/aktsii отдаёт 200 и упомянута в llms.txt как «реальные
 *      скидки из товарного учёта», но в sitemap её нет.
 *   2. Ни одного <image:image> при 6 351 карточке с фотографиями.
 *      Для бьюти-товаров поиск по картинкам — реальный канал: оттенок
 *      гель-лака ищут визуально.
 *   3. changefreq и priority проставлены на всех 6 524 URL. Google
 *      игнорирует их с 2015 года, Яндекс — тоже. Убраны.
 *   4. У 103 URL не было lastmod. Проставляется всегда.
 *   5. Товары не в наличии (~32 % каталога) получают честный старый
 *      lastmod, чтобы краулинговый бюджет уходил на живые позиции.
 */

declare function getStaticPages(): Promise<{ path: string; updatedAt: Date }[]>
declare function getCategories(): Promise<{ path: string; updatedAt: Date }[]>
declare function getBrandSlugs(): Promise<{ slug: string; updatedAt: Date }[]>
declare function getBlogPosts(): Promise<{ slug: string; updatedAt: Date }[]>
declare function getProductsForSitemap(): Promise<
  { slug: string; updatedAt: Date; inStock: boolean; images: string[] }[]
>

/** Страницы, которых не хватало в карте. */
const MISSING_STATIC_PATHS = [
  '/catalog/aktsii', // P2-9: 200, коммерческий интент, не было в sitemap
  '/brand', // новый хаб брендов (P1-7)
] as const

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [staticPages, categories, brands, posts, products] = await Promise.all([
    getStaticPages(),
    getCategories(),
    getBrandSlugs(),
    getBlogPosts(),
    getProductsForSitemap(),
  ])

  const now = new Date()

  const entries: MetadataRoute.Sitemap = [
    ...staticPages.map((p) => ({ url: absolute(p.path), lastModified: p.updatedAt })),

    ...MISSING_STATIC_PATHS.map((path) => ({ url: absolute(path), lastModified: now })),

    ...categories.map((c) => ({ url: absolute(c.path), lastModified: c.updatedAt })),

    ...brands.map((b) => ({ url: absolute(`/brand/${b.slug}`), lastModified: b.updatedAt })),

    ...posts.map((p) => ({ url: absolute(`/blog/${p.slug}`), lastModified: p.updatedAt })),

    ...products.map((p) => ({
      url: absolute(`/product/${p.slug}`),
      // Товары не в наличии не выдаём за свежие — обход должен идти
      // в первую очередь на то, что можно купить.
      lastModified: p.inStock ? p.updatedAt : olderOf(p.updatedAt),
      // Next разворачивает images в <image:image><image:loc>.
      images: p.images.slice(0, 5).map(absolute),
    })),
  ]

  return dedupeByUrl(entries)
}

/** Сдвигает дату назад — сигнал «страница не приоритетна для переобхода». */
function olderOf(date: Date, days = 90): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000)
}

/**
 * Страховка от дублей: MISSING_STATIC_PATHS перестанут быть нужны, как
 * только источник начнёт отдавать эти пути сам, — и тогда без дедупликации
 * они попали бы в карту дважды. Сейчас дублей нет, пусть так и остаётся.
 */
function dedupeByUrl(entries: MetadataRoute.Sitemap): MetadataRoute.Sitemap {
  const seen = new Map<string, MetadataRoute.Sitemap[number]>()
  for (const e of entries) {
    if (!seen.has(e.url)) seen.set(e.url, e)
  }
  return [...seen.values()]
}
