# P1-5 / P1-6 / P2-8. Внутренняя перелинковка

## 1. Чипы брендов ведут в robots-заглушки

На одной странице `/catalog/gel-laki` — **54 ссылки (32 уникальных)** на URL, закрытые в robots.txt:

```
/catalog/dlya-manikyura-i-pedikyura?sub=…&brand=ADRICOCO   ← Disallow: /*?*brand=
/catalog?search=CosmoLac  (×15)                            ← Disallow: /*?*search=
/catalog?search=ADRICOCO  (×8)                             ← Disallow: /*?*search=
```

При этом `/brand/cosmolac` отдаёт 200 и полностью пригоден к ранжированию (`Brand` + `ItemList` + `FAQPage` + `BreadcrumbList`, осмысленные title и H1).

Фильтр должен остаться фильтром для пользователя, но ссылка обязана вести на индексируемую страницу там, где она есть:

```tsx
// Есть страница бренда — ведём на неё. Нет — оставляем фильтр,
// но закрываем ссылку от передачи веса в robots-заглушку.
function BrandChip({ brand, categorySlug }: { brand: Brand; categorySlug: string }) {
  if (brand.landingSlug) {
    return <Link href={`/brand/${brand.landingSlug}`}>{brand.name}</Link>
  }
  return (
    <Link href={buildCatalogUrl(categorySlug, { brand: brand.name })} rel="nofollow">
      {brand.name}
    </Link>
  )
}
```

Та же ошибка в `llms.txt`: строка «Бренд Prozatochka» ссылается на `/catalog?brand=Prozatochka` (закрыт в robots.txt), хотя `/brand/prozatochka` отдаёт 200. Заменить на `/brand/prozatochka`.

## 2. `/brand` — 404

Страниц брендов девять, но хаба нет: `/brand`, `/brands`, `/catalog/brands` — все 404. Из-за этого брендовые страницы почти сироты: на них ссылается только главная (1 ссылка) и они сами друг на друга (3). Ни каталог, ни категории, ни карточки товара на них не ссылаются вообще.

Нужны:
- `/brand` — список всех брендов с `CollectionPage` + `ItemList`;
- ссылка на хаб в футере;
- ссылка на `/brand/{slug}` с карточки товара (у товара бренд уже известен — он есть в `Product.brand`).

## 3. Лендинг категории теряет пагинацию

`/catalog/gel-laki` — чистый ЧПУ-лендинг, но его пагинация ведёт на **другой URL**:

```
/catalog/dlya-manikyura-i-pedikyura?page=2&sub=%D0%93%D0%B5%D0%BB%D1%8C-%D0%BB%D0%B0%D0%BA%D0%B8%2C%20…
… до page=10
```

Страница 1 коллекции живёт на `/catalog/gel-laki`, страницы 2–10 — на длинном параметрическом адресе. Краулер видит лендинг как тупик из 30 товаров, а остальные 270 привязываются к другому URL; внутренний вес расщепляется между двумя адресами одной коллекции.

Компонент пагинации должен строить ссылки **от текущего URL**, а не от канонического адреса родительской категории:

```tsx
// Было: пагинация собиралась из «настоящего» адреса категории + sub=
// Стало: сохраняем тот путь, по которому пользователь и краулер пришли.
const href = buildPageUrl(pathname, { ...currentSearchParams, page: n === 1 ? undefined : n })
```

## 4. Один хелпер на кодирование `sub=`

На одной странице **25 ссылок с `%20`** и **24 с `+`** внутри одного и того же значения `sub=`. Canonical нормализует к `+`, поэтому дублей в индексе не будет — но примерно половина внутренних ссылок (включая `BreadcrumbList` в JSON-LD, где везде `%20`) указывает на неканоническую версию, и краулер тратит бюджет на лишний хоп.

Причина — два способа сборки URL в разных местах: `URLSearchParams` кодирует пробел как `+`, а `encodeURIComponent` — как `%20`.

Все ссылки, включая JSON-LD хлебных крошек, должны строиться одним хелпером:

```ts
export function buildCatalogUrl(
  slug: string,
  params: Record<string, string | number | undefined>,
): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  }
  const s = qs.toString()          // пробел → '+', как в canonical
  return `/catalog/${slug}${s ? `?${s}` : ''}`
}
```

## Проверка после выкатки

```bash
# ссылок на robots-закрытые URL должно стать 0
curl -s https://cosmex.ru/catalog/gel-laki \
  | grep -o 'href="[^"]*"' \
  | grep -cE '\?[^"]*(brand=|search=|sort=|priceM|instock=)'

# хаб брендов должен отдавать 200
curl -so /dev/null -w '%{http_code}\n' https://cosmex.ru/brand

# пагинация должна остаться на том же пути
curl -s https://cosmex.ru/catalog/gel-laki | grep -o 'href="/catalog/[^"]*page=2[^"]*"' | head -1
```
