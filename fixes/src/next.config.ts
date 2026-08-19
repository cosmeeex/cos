import type { NextConfig } from 'next'

/**
 * Настройки, относящиеся к находкам аудита.
 * Слить с существующим next.config, не заменять его целиком.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        /**
         * P1-3: /images/logo.png и /images/original/workshop/workshop-04.jpg
         * отдаются с `Cache-Control: public, max-age=0`. Второй файл — это
         * LCP-картинка главной (она же в <link rel="preload"
         * fetchpriority="high">), 95 554 байта, и она перезапрашивается
         * при каждом заходе.
         *
         * Для сравнения, /_next/static/* настроен правильно:
         * max-age=31536000, immutable.
         *
         * Дублирует правку в fixes/nginx/cosmex-cache.conf — достаточно
         * одной из двух. Здесь она на случай, если доступа к nginx нет.
         */
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2592000, stale-while-revalidate=86400',
          },
        ],
      },
      {
        /**
         * P1-4: /api/image/proxy отдаёт ДВА заголовка Cache-Control —
         * `public, max-age=0, s-maxage=300, stale-while-revalidate=86400`
         * и `public, max-age=86400`. По RFC 9111 они склеиваются в список
         * с двумя max-age; клиенты берут более строгое, то есть фото
         * товаров не кэшируются браузером вообще. На карточке ~40
         * изображений по ~68 КБ.
         *
         * Здесь заголовок задаётся один раз. Второй источник (тот, что
         * выставляет заголовок внутри самого маршрута) нужно убрать —
         * иначе они снова сложатся.
         */
        source: '/api/image/proxy',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
          },
          // Ответ зависит только от поддержки WebP/AVIF. RSC-заголовки
          // на бинарной картинке смысла не имеют и дробят кэш CDN.
          { key: 'Vary', value: 'Accept' },
        ],
      },
    ]
  },

  /**
   * P0-1, запасной вариант.
   *
   * Основное исправление — на nginx (fixes/nginx/cosmex-cache.conf):
   * оно разводит кэш на ботовый и пользовательский варианты и сохраняет
   * быстрый TTFB живым пользователям.
   *
   * Если правки nginx недоступны — раскомментируйте строку ниже. Метаданные
   * станут всегда блокирующими, вариант будет один, и вопрос кэш-ключа
   * отпадёт. Плата: TTFB карточки (сейчас 1,29 с без кэша) дополнительно
   * ждёт разрешения generateMetadata для КАЖДОГО пользователя, а не только
   * для ботов.
   *
   * Ключ лежит в experimental и между минорными версиями Next переезжал —
   * сверьтесь с документацией своей версии и убедитесь, что сборка не пишет
   * предупреждение о неизвестной опции, иначе настройка молча не применится.
   */
  // experimental: { streamingMetadata: false },
}

export default nextConfig
