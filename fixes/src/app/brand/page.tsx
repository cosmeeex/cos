import type { Metadata } from 'next'
import Link from 'next/link'
import { BRAND_LANDINGS } from '@/lib/seo/brands'
import { absolute, buildBrandUrl } from '@/lib/seo/url'

/**
 * Хаб брендов — страница /brand.
 *
 * Закрывает P1-7 из docs/seo-audit.md: сейчас /brand, /brands и
 * /catalog/brands все отдают 404. Девять существующих страниц
 * /brand/{slug} из-за этого почти сироты — на них ссылается только
 * главная (1 ссылка) и они сами друг на друга (3). Ни каталог, ни
 * категории, ни карточки товара на них не ссылаются вообще.
 *
 * Хаб + ссылка на него в футере + ссылка на бренд с карточки товара
 * (бренд уже известен, он есть в Product.brand) замыкают обход.
 *
 * Данные лучше брать из того же источника, что и страницы брендов,
 * а не из статического словаря: getBrandsWithLandings() ниже —
 * точка подключения. BRAND_LANDINGS оставлен как запасной вариант
 * и как единый список того, что уже опубликовано.
 */

export const metadata: Metadata = {
  title: 'Бренды профессиональной косметики и инструмента | Cosmex',
  description:
    'Все бренды в наличии в Cosmex: Staleks, CosmoLac, ADRICOCO, Lovely, Planet Nails, Milv, Boheme, KIRA, Prozatochka. Доставка по России, самовывоз в Новосибирске.',
  alternates: { canonical: absolute('/brand') },
  robots: { index: true, follow: true },
}

type BrandCard = { name: string; slug: string; productCount?: number }

async function getBrandsWithLandings(): Promise<BrandCard[]> {
  // TODO: заменить на реальный источник (тот же, что питает /brand/[slug]).
  return Object.entries(BRAND_LANDINGS).map(([name, slug]) => ({
    name: name.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase()),
    slug,
  }))
}

export default async function BrandHubPage() {
  const brands = await getBrandsWithLandings()
  const sorted = [...brands].sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Бренды Cosmex',
      url: absolute('/brand'),
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: sorted.length,
        itemListElement: sorted.map((b, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: b.name,
          url: absolute(buildBrandUrl(b.slug)),
        })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: absolute('/') },
        { '@type': 'ListItem', position: 2, name: 'Бренды', item: absolute('/brand') },
      ],
    },
  ]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <h1>Бренды в Cosmex</h1>
      <p>
        Профессиональная косметика, инструмент и оборудование от производителей, с которыми
        мы работаем напрямую. Цены без наценки маркетплейса, самовывоз в Новосибирске,
        доставка СДЭК по всей России.
      </p>

      <ul>
        {sorted.map((b) => (
          <li key={b.slug}>
            <Link href={buildBrandUrl(b.slug)}>{b.name}</Link>
            {b.productCount ? <span> — {b.productCount} позиций</span> : null}
          </li>
        ))}
      </ul>
    </>
  )
}
