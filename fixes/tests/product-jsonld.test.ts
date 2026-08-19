import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildProductJsonLd } from '../src/lib/seo/product-jsonld.ts'

/** Реальный товар с прода (18.08.2026). */
const PRODUCT = {
  name: 'Cosmex Холодный крем-парафин Смородина 50 ml',
  description: 'Крем-парафин Cosmex…',
  url: '/product/cosmex-holodnyy-krem-parafin-smorodina-50-ml-92226549-91bf-11ef-0a80-158d000444e6',
  images: ['/api/image/proxy?url=https%3A%2F%2Fapi.moysklad.ru%2F…&s=1200'],
  brand: 'Cosmex',
  sku: 'CX-001',
  price: 220,
  inStock: false,
  priceValidUntil: '2026-09-17',
}

describe('P2-10: недостающие поля Offer', () => {
  const ld = buildProductJsonLd(PRODUCT)
  const offers = ld.offers as Record<string, unknown>

  it('добавляет shippingDetails — условие merchant-сниппетов Google', () => {
    const s = offers.shippingDetails as Record<string, unknown>
    assert.equal(s['@type'], 'OfferShippingDetails')
    assert.ok(s.shippingRate)
    assert.ok(s.deliveryTime)
  })

  it('добавляет hasMerchantReturnPolicy', () => {
    const r = offers.hasMerchantReturnPolicy as Record<string, unknown>
    assert.equal(r['@type'], 'MerchantReturnPolicy')
    assert.equal(r.applicableCountry, 'RU')
    assert.equal(r.merchantReturnDays, 7)
  })

  it('добавляет itemCondition', () => {
    assert.equal(offers.itemCondition, 'https://schema.org/NewCondition')
  })

  it('сохраняет поля, которые уже были на проде', () => {
    assert.equal(offers.priceCurrency, 'RUB')
    assert.equal(offers.price, '220')
    assert.equal(offers.priceValidUntil, '2026-09-17')
    assert.equal(offers.availability, 'https://schema.org/OutOfStock')
    assert.equal(ld.sku, 'CX-001')
    assert.deepEqual(ld.brand, { '@type': 'Brand', name: 'Cosmex' })
  })

  it('InStock проставляется корректно', () => {
    const inStock = buildProductJsonLd({ ...PRODUCT, inStock: true })
    assert.equal(
      (inStock.offers as Record<string, unknown>).availability,
      'https://schema.org/InStock',
    )
  })
})

describe('абсолютные URL', () => {
  const ld = buildProductJsonLd(PRODUCT)

  it('url товара абсолютный', () => {
    assert.ok(String(ld.url).startsWith('https://cosmex.ru/product/'))
  })

  it('картинки абсолютные', () => {
    for (const img of ld.image as string[]) {
      assert.ok(img.startsWith('https://cosmex.ru/'), img)
    }
  })

  it('offers.url совпадает с url товара', () => {
    assert.equal((ld.offers as Record<string, unknown>).url, ld.url)
  })
})

describe('aggregateRating — только по реальным отзывам', () => {
  it('без отзывов разметки нет', () => {
    assert.equal('aggregateRating' in buildProductJsonLd(PRODUCT), false)
  })

  it('с count = 0 разметки нет — звёзды не дорисовываем', () => {
    const ld = buildProductJsonLd({ ...PRODUCT, rating: { value: 0, count: 0 } })
    assert.equal('aggregateRating' in ld, false)
  })

  it('с настоящими отзывами разметка появляется', () => {
    const ld = buildProductJsonLd({ ...PRODUCT, rating: { value: 4.8, count: 17 } })
    assert.deepEqual(ld.aggregateRating, {
      '@type': 'AggregateRating',
      ratingValue: 4.8,
      reviewCount: 17,
      bestRating: 5,
      worstRating: 1,
    })
  })
})

describe('необязательные поля не создают пустых ключей', () => {
  it('без gtin13/mpn/category ключей нет', () => {
    const ld = buildProductJsonLd({ ...PRODUCT, brand: undefined, sku: undefined })
    for (const k of ['brand', 'sku', 'mpn', 'gtin13', 'category']) {
      assert.equal(k in ld, false, `лишний ключ ${k}`)
    }
  })

  it('переданные поля попадают в разметку', () => {
    const ld = buildProductJsonLd({ ...PRODUCT, gtin13: '4600000000001', category: 'Уход за телом' })
    assert.equal(ld.gtin13, '4600000000001')
    assert.equal(ld.category, 'Уход за телом')
  })
})
