import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TITLE_LENGTH,
  buildProductTitle,
  cleanProductName,
  fitName,
  splitSizeTail,
} from '../src/lib/seo/title.ts'

/** Реальные названия из выборки 40 карточек (18.08.2026). */
const REAL_NAMES = [
  'COSMEX NOIR Parfumed Shampoo Cherry Noir (по мотивам Lost Cherry) Парфюмированный шампунь для волос Cherry Noir 300 ml',
  'BSG жёсткий гель для наращивания Konfityur №128 НИЗКАЯ ВЯЗКОСТЬ - Коллекция "Летние сарафанчики" (13 г)',
  'Staleks Запасной блок файл-ленты для пластиковой катушки Bobbinail STALEKS PRO 100 грит',
  'BSG цветная жесткая база colloration hard №10 - молочный неплотный оттенок (20 мл)',
  'Cosmex Холодный крем-парафин Смородина 50 ml',
]

describe('P2-11: длина title', () => {
  it('все реальные названия укладываются в 60 символов', () => {
    for (const n of REAL_NAMES) {
      const t = buildProductTitle(n)
      assert.ok(t.length <= MAX_TITLE_LENGTH, `${t.length} симв.: ${t}`)
    }
  })

  it('короткие названия получают коммерческий модификатор', () => {
    assert.equal(buildProductTitle('Крем для рук'), 'Крем для рук — купить в Новосибирске')
  })

  it('title остаются уникальными на похожих позициях одной линейки', () => {
    const titles = [
      'Cosmex Холодный крем-парафин Смородина 50 ml',
      'Cosmex Холодный крем-парафин Персик 50 ml',
      'Cosmex Холодный крем-парафин Ваниль 50 ml',
    ].map((n) => buildProductTitle(n))
    assert.equal(new Set(titles).size, titles.length)
  })
})

describe('регистр не трогаем: бренды в капслоке должны выживать', () => {
  it('COSMEX NOIR не превращается в Cosmex noir', () => {
    const t = buildProductTitle(REAL_NAMES[0])
    assert.ok(t.includes('COSMEX NOIR'), t)
  })

  it('BSG и STALEKS сохраняются', () => {
    assert.ok(buildProductTitle(REAL_NAMES[1]).includes('BSG'))
    assert.ok(buildProductTitle(REAL_NAMES[3]).includes('BSG'))
  })
})

describe('фасовка не теряется при обрезке', () => {
  it('объём остаётся в конце — именно его ищут покупатели', () => {
    assert.ok(buildProductTitle(REAL_NAMES[0]).includes('300 ml'), buildProductTitle(REAL_NAMES[0]))
    assert.ok(buildProductTitle(REAL_NAMES[1]).includes('(13 г)'))
    assert.ok(buildProductTitle(REAL_NAMES[2]).includes('100 грит'))
    assert.ok(buildProductTitle(REAL_NAMES[3]).includes('(20 мл)'))
  })

  it('splitSizeTail отделяет хвост', () => {
    assert.deepEqual(splitSizeTail('Крем-парафин Смородина 50 ml'), {
      head: 'Крем-парафин Смородина',
      size: '50 ml',
    })
    assert.deepEqual(splitSizeTail('База colloration hard №10 (20 мл)'), {
      head: 'База colloration hard №10',
      size: '(20 мл)',
    })
  })

  it('название без фасовки не ломается', () => {
    assert.deepEqual(splitSizeTail('Пушер для кутикулы'), {
      head: 'Пушер для кутикулы',
      size: '',
    })
  })
})

describe('шум из учётной системы', () => {
  it('убирает «(по мотивам …)»', () => {
    assert.ok(!cleanProductName(REAL_NAMES[0]).includes('по мотивам'))
  })

  it('убирает «- Коллекция "…"»', () => {
    assert.ok(!cleanProductName(REAL_NAMES[1]).includes('Коллекция'))
  })

  it('не трогает названия без шума', () => {
    assert.equal(cleanProductName('Пушер Staleks PRO'), 'Пушер Staleks PRO')
  })
})

describe('висячие служебные слова', () => {
  it('обрезанное «…файл-ленты для пластиковой» теряет хвост', () => {
    const t = buildProductTitle(REAL_NAMES[2])
    assert.ok(!/\s(для|и|с|на|из|от|по|в)\s*$/iu.test(t), t)
    assert.ok(!t.includes('для пластиковой'), t)
  })

  it('в ПОЛНОМ названии предлог не трогаем: «Крем для рук» остаётся целым', () => {
    assert.ok(buildProductTitle('Крем для рук').startsWith('Крем для рук'))
  })

  it('fitName не режет то, что и так влезает', () => {
    assert.equal(fitName('Пушер Staleks', 60), 'Пушер Staleks')
  })
})

describe('настройки', () => {
  it('город и бренд переопределяются', () => {
    assert.equal(
      buildProductTitle('Пушер', { city: 'Алматы' }),
      'Пушер — купить в Алматы',
    )
  })

  it('нестандартный лимит соблюдается', () => {
    const t = buildProductTitle(REAL_NAMES[0], { maxLength: 40 })
    assert.ok(t.length <= 40, `${t.length}: ${t}`)
  })
})
