import type { MetadataRoute } from 'next'
import { absolute } from '@/lib/seo/url'

/**
 * robots.txt.
 *
 * Текущий файл почти в порядке — правки минимальные:
 *
 *   1. Убрана директива `Host:` — Яндекс не использует её с 2018 года.
 *   2. `?page=` намеренно НЕ закрывается: пагинация должна обходиться,
 *      иначе товары со страниц 2+ выпадут из индекса. Бесконечное
 *      краулинговое пространство лечится кодом (404 за пределом
 *      диапазона, см. lib/seo/pagination.ts), а не запретом обхода.
 *   3. Список правил вынесен в одну константу: раньше он был скопирован
 *      в 13 секций User-Agent, и любая правка требовала 13 синхронных
 *      изменений — источник расхождений.
 *
 * Важно про `?brand=` и `?search=`: они остаются закрытыми, но тогда на
 * них не должно быть внутренних ссылок. Сейчас их 54 на одной странице
 * каталога (P1-5) — это чинится в components/BrandChip.tsx.
 */

const DISALLOW = [
  '/account',
  '/admin/',
  '/api/admin/',
  '/api/customer/',
  '/api/order',
  '/api/sse/',
  '/api/feeds/',
  '/*?*brand=',
  '/*?*priceMin=',
  '/*?*priceMax=',
  '/*?*instock=',
  '/*?*sort=',
  '/*?*search=',
  '/*?*focus=',
  '/*?*_rsc=',
  '/*?*utm_',
  '/*?*RID=',
  '/*?*section_id=',
  '/*?*display=',
  '/*?*PAGEN_1=',
  '/*?*etext=',
]

/** Поисковые и AI-краулеры, которым открыт тот же доступ, что и всем. */
const NAMED_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Google-Extended',
  'PerplexityBot',
  'YandexGPT',
  'Applebot-Extended',
  'CCBot',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      ...NAMED_AGENTS.map((userAgent) => ({ userAgent, allow: '/', disallow: DISALLOW })),
    ],
    sitemap: absolute('/sitemap.xml'),
  }
}
