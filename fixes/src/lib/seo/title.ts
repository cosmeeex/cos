/**
 * Генератор title карточки товара.
 *
 * Закрывает P2-11 из docs/seo-audit.md. Выборка 40 товаров:
 * title уникальны 40/40, но длина 33 / 63 / 127 символов
 * (мин / средн / макс) — 20 из 40 длиннее 60 и обрезаются в выдаче.
 *
 *   127: COSMEX NOIR Parfumed Shampoo Cherry Noir (по мотивам Lost Cherry)
 *        Парфюмированный шампунь для волос Cherry Noir 300 ml | Cosmex
 *   112: BSG жёсткий гель для наращивания Konfityur №128 НИЗКАЯ ВЯЗКОСТЬ -
 *        Коллекция "Летние сарафанчики" (13 г) | Cosmex
 *
 * Шаблон сейчас — `{название из МойСклад} | Cosmex`. Названия в учётной
 * системе пишутся для склада, а не для выдачи: артикулы, названия
 * коллекций, дубли переводов.
 *
 * Description менять не нужно — они хорошие: 149–168 символов, уникальные.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Осознанно консервативный модуль. Автоматическая «причёсывалка» названий
 * легко делает хуже: первая версия этого файла приводила капслок к
 * нормальному регистру и превращала бренд COSMEX NOIR в «Cosmex noir».
 * Поэтому здесь только те преобразования, которые безопасны на любом
 * названии:
 *   1) удаление точечного списка проверенных шумовых конструкций,
 *   2) обрезка по границе слова,
 *   3) сохранение хвоста с объёмом/весом — именно его ищут покупатели.
 * Регистр не трогаем вообще: отличить бренд от крика автоматически нельзя.
 * Список NOISE_PATTERNS расширяйте только проверенными шаблонами.
 */

export const MAX_TITLE_LENGTH = 60

/** Проверенный шум из учётной системы. Каждый шаблон — с примером. */
const NOISE_PATTERNS: RegExp[] = [
  // «COSMEX NOIR … (по мотивам Lost Cherry) Парфюмированный шампунь …»
  /\s*\(\s*по мотивам[^)]*\)/giu,
  // «… НИЗКАЯ ВЯЗКОСТЬ - Коллекция "Летние сарафанчики" (13 г)»
  /\s*[-–—]?\s*Коллекция\s*[«"“][^»"”]*[»"”]/giu,
]

/**
 * Хвост с фасовкой: «300 ml», «(13 г)», «50 мл», «20 г».
 * Его нельзя терять при обрезке — покупатель ищет конкретный объём,
 * и без него две позиции одной линейки дают одинаковый title.
 */
const SIZE_TAIL = /\(?\s*\d+[.,]?\d*\s*(?:ml|мл|г|гр|kg|кг|l|л|шт|грит)\s*\)?\s*$/iu

const PREPOSITION =
  '(?:для|и|с|со|на|из|от|по|в|во|к|о|об|при|до|под|над|за|у)'

/** «… файл-ленты для» — предлог в конце. */
const DANGLING_WORD = new RegExp(`\\s+${PREPOSITION}$`, 'iu')
/** «… файл-ленты для пластиковой» — предлог + осиротевшее определение. */
const DANGLING_PHRASE = new RegExp(`\\s+${PREPOSITION}\\s+\\S+$`, 'iu')

function tidy(s: string): string {
  return s
    .replace(/\s+/gu, ' ')
    .replace(/\s*([-–—,])\s*$/u, '')
    .replace(/^\s*([-–—,])\s*/u, '')
    .trim()
}

/**
 * Убирает хвост, повисший ПОСЛЕ ОБРЕЗКИ: «файл-ленты для пластиковой»
 * (существительное «катушки» осталось за лимитом) → «файл-ленты».
 *
 * Применяется ТОЛЬКО к усечённым строкам. На полном названии это было бы
 * разрушительно: «Крем для рук» превратился бы в «Крем».
 */
function trimDangling(s: string): string {
  let out = tidy(s)
  let prev: string
  do {
    prev = out
    out = tidy(out.replace(DANGLING_PHRASE, '').replace(DANGLING_WORD, ''))
  } while (out !== prev)
  return out
}

export function cleanProductName(raw: string): string {
  let s = raw
  for (const re of NOISE_PATTERNS) s = s.replace(re, ' ')
  return tidy(s)
}

/** Отделяет хвост с фасовкой от остального названия. */
export function splitSizeTail(name: string): { head: string; size: string } {
  const m = name.match(SIZE_TAIL)
  if (!m) return { head: name, size: '' }
  return { head: tidy(name.slice(0, m.index)), size: tidy(m[0]) }
}

/** Обрезает по границе слова — без огрызков посреди слова. */
export function truncateOnWord(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut
  return trimDangling(base)
}

/**
 * Обрезает название до лимита, сохраняя хвост с фасовкой.
 * «Cosmex Холодный крем-парафин Смородина 50 ml» → «Cosmex Холодный крем-парафин 50 ml»
 */
export function fitName(name: string, max: number): string {
  if (name.length <= max) return name

  const { head, size } = splitSizeTail(name)
  if (!size) return truncateOnWord(name, max)

  // +1 на пробел между обрезанным началом и хвостом.
  const room = max - size.length - 1
  if (room < 12) return truncateOnWord(name, max) // хвост слишком длинный, смысла нет
  return tidy(`${truncateOnWord(head, room)} ${size}`)
}

export type TitleOptions = {
  /** Город для коммерческого модификатора, в предложном падеже. */
  city?: string
  /** Бренд магазина — хвост последнего резерва. */
  brand?: string
  maxLength?: number
}

/**
 * Собирает title из кандидатов по убыванию ценности и берёт первый,
 * который влезает в лимит.
 *
 * Для длинных названий коммерческий модификатор отбрасывается, а не
 * вытесняет само название: для низкочастотных товаров именно полное
 * название и есть запрос, ради которого страница ранжируется.
 */
export function buildProductTitle(rawName: string, options: TitleOptions = {}): string {
  const { city = 'Новосибирске', brand = 'Cosmex', maxLength = MAX_TITLE_LENGTH } = options
  const name = cleanProductName(rawName)

  const candidates = [
    `${name} — купить в ${city}`,
    `${name} — купить`,
    `${name} | ${brand}`,
    name,
  ]

  for (const c of candidates) {
    if (c.length <= maxLength) return c
  }

  return fitName(name, maxLength)
}
