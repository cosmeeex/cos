/**
 * Product JSON-LD с полными данными о доставке и возврате.
 *
 * Закрывает P2-10 из docs/seo-audit.md. Сейчас на карточке отдаётся:
 *
 *   {"@type":"Product","name":…,"description":…,"image":[…],"brand":…,
 *    "sku":…,"mpn":…,
 *    "offers":{"@type":"Offer","priceCurrency":"RUB","price":"220",
 *              "availability":"https://schema.org/OutOfStock",
 *              "priceValidUntil":"2026-09-17","url":…,"seller":…}}
 *
 * Нет: itemCondition, shippingDetails, hasMerchantReturnPolicy,
 * aggregateRating, review, gtin13.
 *
 * shippingDetails и hasMerchantReturnPolicy — условие полной выдачи
 * merchant-сниппетов Google (цена + доставка + возврат прямо в SERP).
 */

import { absolute } from './url.ts'

export type ShippingPolicy = {
  /** Стоимость доставки в рублях. 0 — бесплатно. */
  rate: number
  /** Сколько дней уходит на сборку заказа. */
  handlingDays: [min: number, max: number]
  /** Сколько дней идёт доставка. */
  transitDays: [min: number, max: number]
  country: string
}

export type ReturnPolicy = {
  country: string
  /** Дней на возврат. Для дистанционной торговли в РФ — 7 (ст. 26.1 ЗоЗПП). */
  days: number
  /** Кто платит за обратную пересылку. */
  feesPaidBy: 'customer' | 'merchant'
}

/**
 * Значения по умолчанию собраны из /page/delivery и llms.txt.
 * СВЕРЬТЕ С ОФЕРТОЙ ПЕРЕД ВЫКАТКОЙ: разметка, расходящаяся с реальными
 * условиями магазина, — повод для ручных санкций у обоих поисковиков.
 */
export const DEFAULT_SHIPPING: ShippingPolicy = {
  rate: 0,
  handlingDays: [1, 2],
  transitDays: [2, 8],
  country: 'RU',
}

export const DEFAULT_RETURNS: ReturnPolicy = {
  country: 'RU',
  days: 7,
  feesPaidBy: 'customer',
}

export type ProductInput = {
  name: string
  description: string
  url: string
  images: string[]
  brand?: string
  sku?: string
  mpn?: string
  /** Штрихкод из МойСклад, если ведётся. Улучшает сопоставление товара. */
  gtin13?: string
  /** Полный путь категории — помогает и Google, и Яндекс.Товарам. */
  category?: string
  price: number
  currency?: string
  inStock: boolean
  /** ISO-дата, до которой цена действительна. */
  priceValidUntil: string
  /**
   * Агрегат отзывов. Передавать ТОЛЬКО когда на странице есть настоящие
   * отзывы, видимые пользователю. Разметка без видимых отзывов (или с
   * выдуманными) — прямое нарушение правил Google и Яндекса.
   */
  rating?: { value: number; count: number }
}

function quantitativeDays([min, max]: [number, number]) {
  return { '@type': 'QuantitativeValue', minValue: min, maxValue: max, unitCode: 'DAY' }
}

export function buildOfferShippingDetails(p: ShippingPolicy = DEFAULT_SHIPPING) {
  return {
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: String(p.rate), currency: 'RUB' },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: p.country },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: quantitativeDays(p.handlingDays),
      transitTime: quantitativeDays(p.transitDays),
    },
  }
}

export function buildReturnPolicy(p: ReturnPolicy = DEFAULT_RETURNS) {
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: p.country,
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: p.days,
    returnMethod: 'https://schema.org/ReturnByMail',
    returnFees:
      p.feesPaidBy === 'merchant'
        ? 'https://schema.org/FreeReturn'
        : 'https://schema.org/ReturnShippingFees',
  }
}

export function buildProductJsonLd(
  product: ProductInput,
  policies: { shipping?: ShippingPolicy; returns?: ReturnPolicy } = {},
): Record<string, unknown> {
  const url = absolute(product.url)

  const offers: Record<string, unknown> = {
    '@type': 'Offer',
    url,
    priceCurrency: product.currency ?? 'RUB',
    price: String(product.price),
    priceValidUntil: product.priceValidUntil,
    availability: product.inStock
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock',
    itemCondition: 'https://schema.org/NewCondition',
    seller: { '@type': 'Organization', name: 'Cosmex' },
    shippingDetails: buildOfferShippingDetails(policies.shipping),
    hasMerchantReturnPolicy: buildReturnPolicy(policies.returns),
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    url,
    image: product.images.map(absolute),
    offers,
  }

  if (product.brand) jsonLd.brand = { '@type': 'Brand', name: product.brand }
  if (product.sku) jsonLd.sku = product.sku
  if (product.mpn) jsonLd.mpn = product.mpn
  if (product.gtin13) jsonLd.gtin13 = product.gtin13
  if (product.category) jsonLd.category = product.category

  // Только реальные отзывы. Нет отзывов — нет разметки, звёзд в выдаче
  // мы не «дорисовываем».
  if (product.rating && product.rating.count > 0) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.rating.value,
      reviewCount: product.rating.count,
      bestRating: 5,
      worstRating: 1,
    }
  }

  return jsonLd
}
