# P2-10. Пробелы в Product-разметке

> **Реализация:** [`../src/lib/seo/product-jsonld.ts`](../src/lib/seo/product-jsonld.ts) — собрано и покрыто тестами (`fixes/tests/product-jsonld.test.ts`). Ниже — разбор находки.

## Что отдаётся сейчас

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Cosmex Холодный крем-парафин Смородина 50 ml",
  "description": "…",
  "image": ["https://cosmex.ru/api/image/proxy?url=…&s=1200", "…"],
  "brand": {…},
  "sku": "…",
  "mpn": "…",
  "offers": {
    "@type": "Offer",
    "priceCurrency": "RUB",
    "price": "220",
    "availability": "https://schema.org/OutOfStock",
    "priceValidUntil": "2026-09-17",
    "url": "…",
    "seller": { "@type": "Organization", "name": "Cosmex" }
  }
}
```

Отсутствуют: `itemCondition`, `shippingDetails`, `hasMerchantReturnPolicy`, `aggregateRating`, `review`, `gtin13`.

`shippingDetails` и `hasMerchantReturnPolicy` — условие полной выдачи merchant-сниппетов Google (цена + доставка + возврат прямо в результатах поиска).

## Что добавить

Доставка и возврат берутся из уже существующих страниц `/page/delivery` и правил магазина — это статические данные, отдельный источник не нужен:

```ts
const offers = {
  '@type': 'Offer',
  priceCurrency: 'RUB',
  price: String(product.price),
  availability: product.inStock
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock',
  priceValidUntil: priceValidUntil,
  url: productUrl,
  itemCondition: 'https://schema.org/NewCondition',
  seller: { '@type': 'Organization', name: 'Cosmex' },

  shippingDetails: {
    '@type': 'OfferShippingDetails',
    shippingRate: {
      '@type': 'MonetaryAmount',
      value: '0',                     // подставьте реальный порог бесплатной доставки
      currency: 'RUB',
    },
    shippingDestination: {
      '@type': 'DefinedRegion',
      addressCountry: 'RU',
    },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2, unitCode: 'DAY' },
      transitTime:  { '@type': 'QuantitativeValue', minValue: 2, maxValue: 8, unitCode: 'DAY' },
    },
  },

  hasMerchantReturnPolicy: {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: 'RU',
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: 14,           // ст. 26.1 ЗоЗПП — сверьте с вашей офертой
    returnMethod: 'https://schema.org/ReturnByMail',
    returnFees: 'https://schema.org/ReturnShippingFees',
  },
}
```

Значения выше — заготовка. Сверьте сроки и условия со своей офертой перед выкаткой: разметка, расходящаяся с реальными условиями магазина, — повод для ручных санкций.

## Про `aggregateRating`

Механика уже реализована на `/zatochka` — там размечены и `AggregateRating`, и `Review`. На товарах её нет.

Звёзды в сниппете дают заметный прирост CTR на всех 6 351 карточке без создания нового контента — это самый дешёвый рост из доступных. Но добавлять разметку можно **только после того, как на странице появятся настоящие отзывы**, видимые пользователю. Разметка без видимых отзывов (или с выдуманными) — прямое нарушение и повод для санкций у обоих поисковиков.

Порядок: сбор отзывов (письмо после выкупа, QR в чеке, форма в кабинете) → вывод на карточке → только потом `aggregateRating`.

## `gtin13`

Если штрихкоды ведутся в МойСклад — пробросить в `gtin13`. Это заметно улучшает сопоставление товара в Google Merchant и Яндекс.Товарах.

## Проверка

- Google Rich Results Test — `Product snippets` и `Merchant listings` должны стать без ошибок;
- Яндекс.Вебмастер → «Товары и цены».
