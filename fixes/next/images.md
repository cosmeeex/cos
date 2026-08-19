# P1-3. LCP-изображение главной

> **Реализация:** заголовки — [`../nginx/cosmex-cache.conf`](../nginx/cosmex-cache.conf) и [`../src/next.config.ts`](../src/next.config.ts). Ниже — разбор находки и правка hero через `next/image`.

## Что сейчас

```
/images/original/workshop/workshop-04.jpg
  content-type:  image/jpeg
  content-length: 95 554
  cache-control: public, max-age=0
```

Эта картинка стоит в `<link rel="preload" as="image" fetchpriority="high">` на главной — то есть она и есть LCP-элемент. Три проблемы разом:

1. `max-age=0` — перезапрашивается при каждом заходе (лечится заголовками, см. `fixes/nginx/cosmex-cache.conf`);
2. JPEG вместо WebP/AVIF — при 95 КБ это лишние ~40–60 % веса;
3. отдаётся напрямую из `/images/`, минуя `/_next/image`, который в проекте настроен **правильно**: `max-age=31536000, must-revalidate`, `Vary: Accept`, `x-nextjs-cache: HIT`.

То есть оптимизатор уже работает — hero-картинка просто идёт мимо него.

## Что сделать

```tsx
import Image from 'next/image'
import heroWorkshop from '@/public/images/original/workshop/workshop-04.jpg'

<Image
  src={heroWorkshop}
  alt="Мастерская заточки инструмента Cosmex в Новосибирске"
  priority              // сам поставит preload с fetchpriority="high"
  sizes="100vw"
  quality={75}
  placeholder="blur"    // статический импорт даёт blur-заглушку без лишней работы
/>
```

Статический импорт (а не строковый путь) даёт Next размеры на этапе сборки — уходит CLS, и `placeholder="blur"` работает без ручного `blurDataURL`.

После этого `<link rel="preload">` вручную прописывать не нужно: `priority` делает это сам, а дублирующий preload на исходный JPEG надо убрать — иначе браузер скачает **обе** версии.

## Заодно: alt у изображений товара

На карточке товара 11 из 39 `<img>` имеют `alt=""`. Пустой `alt` уместен только для чисто декоративных элементов. Для товарных фото он должен описывать товар — это и доступность, и трафик из поиска по картинкам (см. `docs/growth-plan.md`, п. 5).

## Проверка

```bash
curl -sI https://cosmex.ru/images/logo.png | grep -i cache-control
# ожидаем: public, max-age=2592000, stale-while-revalidate=86400

curl -s https://cosmex.ru/ | grep -o 'workshop-04[^"]*'
# после правки hero должен идти через /_next/image?url=…
```
