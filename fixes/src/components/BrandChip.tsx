import Link from 'next/link'
import { brandLandingSlug } from '@/lib/seo/brands'
import { buildBrandUrl, buildCatalogUrl } from '@/lib/seo/url'

/**
 * Чип бренда в фильтре каталога.
 *
 * Закрывает P1-5: сейчас все чипы ведут на `?brand=…`, закрытый
 * в robots.txt, хотя для части брендов есть индексируемая посадочная
 * /brand/{slug}.
 *
 * Логика: есть посадочная — ведём на неё и передаём вес. Нет — оставляем
 * фильтр рабочим для пользователя, но помечаем rel="nofollow", чтобы
 * не сливать вес в robots-заглушку.
 */
export function BrandChip({
  brand,
  categorySlug,
  sub,
  isActive,
}: {
  brand: string
  categorySlug?: string
  sub?: string
  isActive?: boolean
}) {
  const landing = brandLandingSlug(brand)

  const href = landing
    ? buildBrandUrl(landing)
    : buildCatalogUrl(categorySlug, { sub, brand })

  return (
    <Link
      href={href}
      rel={landing ? undefined : 'nofollow'}
      aria-current={isActive ? 'true' : undefined}
      data-active={isActive || undefined}
    >
      {brand}
    </Link>
  )
}
