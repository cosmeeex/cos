# P0-2. Закрыть бесконечную индексируемую пагинацию

> **Реализация:** [`../src/lib/seo/pagination.ts`](../src/lib/seo/pagination.ts) — собрано и покрыто тестами (`fixes/tests/pagination.test.ts`). Пример страницы: [`../src/app/catalog-page-example.tsx`](../src/app/catalog-page-example.tsx). Ниже — разбор находки и обоснование.

## Что сейчас

`/catalog/{slug}?page=N` при любом N за пределом диапазона отдаёт **HTTP 200, пустой список товаров и `robots: index, follow` с self-canonical**:

| `page=` | HTTP | robots | товаров | canonical |
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

Невалидные значения обработаны правильно. Проблема ровно в одном: **страница за пределом диапазона — это soft-404, который отдаёт 200 и разрешает себя индексировать.**

`?page=` не закрыт в robots.txt, поэтому краулер волен генерировать `page=2,3,4…` без ограничения. Умножается на 35 категорий и 19 вариантов `?sub=`.

## Что сделать

В `app/catalog/[slug]/page.tsx` (и в том же виде на `/brand/[slug]`) — после получения `total` вернуть `notFound()`, если запрошенная страница больше последней.

```ts
import { notFound, redirect } from 'next/navigation'

const PER_PAGE = 30

export default async function CatalogPage({ params, searchParams }: Props) {
  const { slug } = await params
  const sp = await searchParams

  // Невалидные значения уже канонизируются на базовый URL — приводим их к 1
  // и здесь, чтобы дальше работать с числом.
  const raw = Number(sp.page)
  const page = Number.isInteger(raw) && raw > 0 ? raw : 1

  // ?page=1 эквивалентен базовому URL — 301, как и сейчас.
  if (sp.page !== undefined && page === 1) {
    redirect(buildCatalogUrl(slug, { ...sp, page: undefined }))
  }

  const { items, total } = await getProducts({ slug, page, perPage: PER_PAGE, ...filters(sp) })

  // ── Ключевое исправление ──────────────────────────────────────────────
  // Страница за пределом диапазона должна быть 404, а не пустой 200.
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE))
  if (page > lastPage) notFound()
  // ──────────────────────────────────────────────────────────────────────

  return <CatalogView items={items} page={page} lastPage={lastPage} />
}
```

`notFound()` отдаёт корректный HTTP 404 — этого достаточно, отдельный `noindex` не нужен.

## Заодно: rel=next / rel=prev

Сейчас их нет. Google их не использует с 2019 года, Яндекс — учитывает. Добавить в `generateMetadata` категории:

```ts
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = normalizePage((await searchParams).page)
  const lastPage = await getLastPage(...)

  return {
    alternates: {
      canonical: buildCatalogUrl(slug, { ...sp, page: page > 1 ? page : undefined }),
    },
    other: {
      ...(page > 1        && { prev: buildCatalogUrl(slug, { ...sp, page: page === 2 ? undefined : page - 1 }) }),
      ...(page < lastPage && { next: buildCatalogUrl(slug, { ...sp, page: page + 1 }) }),
    },
  }
}
```

Обратите внимание: `prev` со второй страницы должен вести на базовый URL **без** `?page=1` — иначе снова появится дубль, который сейчас редиректится 301-м.

## Ещё: убрать ссылку на `?page=1` из разметки пагинации

В HTML `/catalog/gel-laki` присутствует ссылка `…?page=1&sub=…`. Она редиректится 301-м на базовый URL, то есть каждая такая ссылка — лишний хоп для краулера. Компонент пагинации должен для первой страницы отдавать URL без параметра `page`.

## Проверка после выкатки

```bash
# должно стать 404
curl -so /dev/null -w '%{http_code}\n' 'https://cosmex.ru/catalog/produktsiya-cosmex?page=999'

# должно остаться 200
curl -so /dev/null -w '%{http_code}\n' 'https://cosmex.ru/catalog/produktsiya-cosmex?page=2'
```
