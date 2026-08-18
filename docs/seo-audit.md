# SEO-аудит cosmex.ru

**Дата:** 18 августа 2026
**Метод:** прямые HTTP-запросы к продакшену с UA реальных краулеров (YandexBot, Googlebot, bingbot, Twitterbot, facebookexternalhit, TelegramBot, WhatsApp, vkShare) и обычного браузера. Каждая находка воспроизводима скриптом `tools/seo-check.sh`.

**Стек:** Next.js (App Router, RSC/Turbopack) за nginx-кэшем (`x-cache-status`, `s-maxage=300, stale-while-revalidate=86400`).

---

## Сводка

| # | Проблема | Приоритет | Масштаб |
|---|---|---|---|
| 1 | `<title>`, `description`, `canonical`, `og:*` уезжают в `<body>` на закэшированных карточках товара | **P0** | 6 351 URL (97 % sitemap) |
| 2 | Бесконечная индексируемая пагинация `?page=N` | **P0** | не ограничен |
| 3 | Статические изображения отдаются с `Cache-Control: max-age=0` | **P1** | все `/images/*`, включая LCP |
| 4 | `/api/image/proxy` отдаёт два конфликтующих `Cache-Control` + мусорный `Vary` | **P1** | все фото товаров |
| 5 | Внутренние ссылки ведут на URL, закрытые в robots.txt | **P1** | 54 ссылки на одной странице |
| 6 | Страница-лендинг теряет свою пагинацию (уходит на другой URL) | **P1** | 16 SEO-категорий |
| 7 | `/brand/*` существуют, но не слинкованы; `/brand` — 404 | **P1** | 9 страниц-сирот |
| 8 | Непоследовательное кодирование `sub=` (`%20` vs `+`) | P2 | ~50 % ссылок |
| 9 | `/catalog/aktsii` отсутствует в sitemap.xml | P2 | 1 коммерческий URL |
| 10 | Product-схема без `aggregateRating`, `shippingDetails`, `hasMerchantReturnPolicy` | P2 | 6 351 URL |
| 11 | 50 % title карточек длиннее 60 символов | P2 | ~3 200 URL |
| 12 | 32 % проиндексированных товаров — `OutOfStock` | P2 | ~2 000 URL |

Что уже сделано хорошо и трогать не нужно: HTTPS/HSTS, строгий CSP, редиректы (`http→https`, `www→apex`, `/catalog/→/catalog`) — все 301 в один хоп; уникальные title/description (40/40 в выборке); Organization/Store/LocalBusiness/FAQPage/HowTo/Service/BreadcrumbList/ItemList разметка; `llms.txt` + `llms-full.txt`; RSS блога; hreflang `ru-RU`/`ru-KZ`/`x-default` — взаимный; блог на 6 500 слов с 69 внутренними ссылками.

---

## P0-1. Метаданные попадают в `<body>`, а не в `<head>`

### Что происходит

На карточках товара `<title>`, `<meta name="description">`, `<link rel="canonical">`, `<meta name="robots">` и весь блок `og:*` рендерятся на ~118 КБ вглубь документа — **внутри `<body>`**, при том что `</head>` закрывается на 6 746 байте.

### Доказательство

Один и тот же URL, оба запроса — промах кэша (`x-cache-status: MISS`):

```
UA=Twitterbot/1.0   cache=MISS  title=HEAD (offset 2725,   head ends 10381)
UA=Chrome/126.0     cache=MISS  title=BODY (offset 118623, head ends 6746)
```

Next.js **корректно** отдаёт блокирующие метаданные ботам из списка `htmlLimitedBots` и стримит их браузерам. Ошибка не в приложении — она в слое кэширования.

Заголовки ответа:

```
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
cache-control: public, max-age=0, s-maxage=300, stale-while-revalidate=86400
```

`Vary` **не содержит `User-Agent`**, и ключ кэша nginx его не учитывает. Значит на URL заводится один общий кэш-объект. Живых браузеров на порядки больше, чем ботов, поэтому в кэш почти всегда попадает **стримовый вариант**, и дальше 300 секунд + сутки `stale-while-revalidate` он отдаётся всем.

Что получают краулеры на закэшированном URL (`x-cache-status: HIT`):

```
Googlebot          title=BODY  canonical=BODY  og:title=BODY
YandexBot          title=BODY  canonical=BODY  og:title=BODY
bingbot            title=BODY  canonical=BODY  og:title=BODY
Twitterbot         title=BODY  canonical=BODY  og:title=BODY
facebookexternalhit title=BODY canonical=BODY  og:title=BODY
TelegramBot        title=BODY  canonical=BODY  og:title=BODY
WhatsApp           title=BODY  canonical=BODY  og:title=BODY
vkShare            title=BODY  canonical=BODY  og:title=BODY
```

### Почему это дорого

- **Яндекс** — основной канал для новосибирского магазина — рендерит JS ограниченно. Тег вне `<head>` может не учитываться как title/canonical.
- **VK, Telegram, WhatsApp** JS не исполняют вообще. Превью ссылок на товар при репостах ломаются — `og:title` и `og:image` лежат в 115 КБ от начала body.
- Разметка `application/ld+json` при этом остаётся в `<head>` — то есть страница выглядит «частично размеченной», что маскирует проблему при беглой проверке.

### Как чинить

Вариант А (рекомендуемый, правится за 5 минут на nginx) — развести кэш на два варианта, ботовый и пользовательский: `fixes/nginx/cosmex-cache.conf`.

Вариант Б (в приложении) — отключить стриминг метаданных, чтобы вариант был один: `fixes/next/next.config.md`.

Вариант А сохраняет быстрый TTFB живым пользователям и потому предпочтителен.

---

## P0-2. Бесконечная индексируемая пагинация

### Доказательство

`/catalog/produktsiya-cosmex?page=…`:

| page= | HTTP | robots | товаров | canonical |
|---|---|---|---|---|
| 1 | 301 | — | — | → базовый URL ✅ |
| 2 | 200 | index, follow | 30 | self ✅ |
| 50 | 200 | index, follow | **0** | self ❌ |
| 999 | 200 | index, follow | **0** | self ❌ |
| 99999 | 200 | index, follow | **0** | self ❌ |
| 1e9 | 200 | index, follow | **0** | self ❌ |
| 0 | 200 | index, follow | 30 | → базовый ✅ |
| -5 | 200 | index, follow | 30 | → базовый ✅ |
| abc | 200 | index, follow | 30 | → базовый ✅ |

Невалидные значения (`0`, `-5`, `abc`) обработаны правильно — канонcalize на базовый URL. А вот **страницы за пределом диапазона отдают 200, пустой список и self-canonical** — это генератор soft-404 неограниченного объёма.

`?page=` не закрыт в robots.txt (закрыт только устаревший `PAGEN_1`), так что краулер волен ходить по `page=2,3,4…` бесконечно. Умножается на 35 категорий и 19 вариантов `?sub=`.

### Как чинить

Возвращать 404 (`notFound()`), когда запрошенная страница больше последней. Код: `fixes/next/pagination-404.md`.

---

## P1-3. Статика отдаётся без браузерного кэша

```
/images/logo.png                          cache-control: public, max-age=0
/images/original/workshop/workshop-04.jpg cache-control: public, max-age=0   (95 554 B, image/jpeg)
/_next/static/chunks/*.css                cache-control: public, max-age=31536000, immutable   ✅
/_next/image?...                          cache-control: public, max-age=31536000, must-revalidate ✅
```

`workshop-04.jpg` — это **LCP-изображение главной**, оно же в `<link rel="preload" fetchpriority="high">`. Оно весит 95 КБ, отдаётся как JPEG (не WebP/AVIF) и с `max-age=0`, то есть при каждом заходе перезапрашивается. Это прямой удар по LCP у возвращающихся пользователей.

Все `/images/*` идут мимо оптимизатора `/_next/image`, который настроен правильно.

Фикс: `fixes/nginx/cosmex-cache.conf` (заголовки) + `fixes/next/images.md` (перевод hero на `next/image`).

---

## P1-4. Два конфликтующих `Cache-Control` на прокси изображений

`/api/image/proxy?url=…` — через него идут **все фото товаров** из МойСклад:

```
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
cache-control: public, max-age=0, s-maxage=300, stale-while-revalidate=86400
cache-control: public, max-age=86400
```

Два заголовка `Cache-Control` в одном ответе. По RFC 9111 они склеиваются в один список, где `max-age` встречается дважды (`0` и `86400`) — поведение не определено, и практически все клиенты берут более строгое значение. Итог: **фото товаров не кэшируются браузером**, каждая карточка перекачивает ~40 изображений по ~68 КБ.

Плюс `Vary: rsc, next-router-state-tree, …` на бинарной картинке: эти заголовки к изображению отношения не имеют, но дробят кэш CDN на варианты.

Фикс: оставить ровно один `Cache-Control` и убрать RSC-`Vary` для этого маршрута — `fixes/nginx/cosmex-cache.conf`.

---

## P1-5. Внутренние ссылки ведут в robots-заглушки

На одной странице `/catalog/gel-laki` — **54 ссылки (32 уникальных)** на URL, закрытые в robots.txt:

```
/catalog/dlya-manikyura-i-pedikyura?sub=…&brand=ADRICOCO      ← Disallow: /*?*brand=
/catalog/dlya-manikyura-i-pedikyura?sub=…&brand=CosmoLac      ← Disallow: /*?*brand=
/catalog?search=CosmoLac  (×15)                               ← Disallow: /*?*search=
/catalog?search=ADRICOCO  (×8)                                ← Disallow: /*?*search=
```

Это чипы брендов в фильтре. Вес внутренних ссылок уходит в закрытые URL.

При этом **страницы брендов существуют и полностью пригодны к ранжированию**:

```
/brand/cosmolac  → 200
  title: CosmoLac гель-лак, базы, топы купить в Новосибирске | Cosmex
  H1:    Купить CosmoLac в Новосибирске
  schema: Brand, ItemList, FAQPage, BreadcrumbList, Service
```

Чипы должны вести на `/brand/{slug}`, а не на закрытый фильтр.

Та же ошибка в `llms.txt`: строка «Бренд Prozatochka» ссылается на `/catalog?brand=Prozatochka` (закрыт в robots.txt), хотя `/brand/prozatochka` отдаёт 200.

---

## P1-6. SEO-лендинг категории теряет свою пагинацию

`/catalog/gel-laki` — чистый ЧПУ-лендинг. Но ссылки его же пагинации ведут на **другой URL**:

```
/catalog/dlya-manikyura-i-pedikyura?page=2&sub=%D0%93%D0%B5%D0%BB%D1%8C-%D0%BB%D0%B0%D0%BA%D0%B8%2C%20…
/catalog/dlya-manikyura-i-pedikyura?page=3&sub=…
… до page=10
```

То есть страница 1 коллекции живёт на красивом `/catalog/gel-laki`, а страницы 2–10 — на длинном параметрическом URL. Краулер видит лендинг как тупик из 30 товаров, а остальные 270 привязываются к другому адресу. Внутренний вес и товарные сигналы расщепляются между двумя URL одной коллекции.

Дополнительно: `rel="next"`/`rel="prev"` отсутствуют (Google их не использует, но Яндекс учитывает), и в списке есть ссылка на `?page=1`, дублирующая базовый URL.

---

## P2-8. Разное кодирование `sub=`

На одной странице: **25 ссылок с `%20`** и **24 с `+`** внутри одного и того же значения `sub=`.

Canonical нормализует к `+`:

```
запрос  ?sub=Cosmex%20Professional → canonical ?sub=Cosmex+Professional
запрос  ?sub=Cosmex+Professional   → canonical ?sub=Cosmex+Professional   ✅
```

Дублирования в индексе не будет — canonical отрабатывает. Но примерно половина внутренних ссылок (включая хлебные крошки в JSON-LD, где `%20`) указывает на неканоническую версию, и краулер тратит бюджет на лишний хоп. Нужно генерировать ссылки одним хелпером.

---

## P2-9. `/catalog/aktsii` не в sitemap

`/catalog/aktsii` отдаёт 200 и упомянута в `llms.txt` как «реальные скидки из товарного учёта» — это коммерческий запрос («акции», «скидки», «распродажа»). В `sitemap.xml` её нет. Схемы `BreadcrumbList` и `ItemList` на ней тоже нет (в отличие от остальных категорий).

---

## P2-10. Пробелы в Product-разметке

```json
{"@type":"Product","name":…,"description":…,"image":[…],"brand":…,"sku":…,"mpn":…,
 "offers":{"@type":"Offer","priceCurrency":"RUB","price":"220",
           "availability":"https://schema.org/OutOfStock",
           "priceValidUntil":"2026-09-17","url":…,"seller":…}}
```

Отсутствуют: `aggregateRating`, `review`, `itemCondition`, `gtin13`, `shippingDetails`, `hasMerchantReturnPolicy`.

`shippingDetails` и `hasMerchantReturnPolicy` — условие полной выдачи merchant-сниппетов Google. Показательно, что на `/zatochka` `AggregateRating` и `Review` уже размечены — значит механика в проекте есть, на товары её просто не завели.

---

## P2-11. Длина title карточек

Выборка 40 товаров: title уникальны 40/40 ✅, длина 33 / 63 / 127 символов (мин/сред/макс), **20 из 40 длиннее 60 символов** — обрезаются в выдаче.

```
127: COSMEX NOIR Parfumed Shampoo Cherry Noir (по мотивам Lost Cherry) Парфюмированный шампунь … | Cosmex
112: BSG жёсткий гель для наращивания Konfityur №128 НИЗКАЯ ВЯЗКОСТЬ - Коллекция "Летние сарафанчики" … | Cosmex
```

Шаблон — `{название из учётной системы} | Cosmex`, без коммерческих модификаторов. Description при этом хорошие: 149–168 символов, уникальные 40/40.

---

## P2-12. Товары не в наличии

В выборке 40 карточек: `InStock` 27, `OutOfStock` 13 — **32 %**. В пересчёте на 6 351 товар это ~2 000 индексируемых страниц без возможности купить. Они расходуют краулинговый бюджет и ухудшают поведенческие.

---

## Прочие мелочи

- `sitemap.xml`: 6 524 URL, 1,5 МБ, дублей нет ✅. Нет `<image:image>` — упущенный трафик из Яндекс/Google Картинок при 6 351 товарной фотографии. `<changefreq>` и `<priority>` проставлены на всех URL, но поисковиками игнорируются. У 103 URL нет `<lastmod>`.
- Страница 404 весит **119 КБ** HTML.
- Главная — 522 КБ HTML, 83 тега `<script>`, ~1,06 МБ JS+CSS без сжатия; один CSS-чанк — 136 КБ.
- TTFB без кэша: главная 1,00 с, категория 0,82 с, карточка 1,29 с.
- `meta name="keywords"` заполнен — поисковиками не используется, вреда нет.
- Директива `Host:` в robots.txt устарела (Яндекс не использует с 2018).
