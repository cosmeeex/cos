import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  absolute,
  buildBrandUrl,
  buildCatalogUrl,
  buildPageUrl,
  buildQuery,
} from '../src/lib/seo/url.ts'

describe('P2-8: единое кодирование параметров', () => {
  it('кодирует пробел как +, а не %20 (так же, как canonical на проде)', () => {
    assert.equal(
      buildCatalogUrl('produktsiya-cosmex', { sub: 'Cosmex Professional' }),
      '/catalog/produktsiya-cosmex?sub=Cosmex+Professional',
    )
  })

  it('совпадает с canonical, который отдаёт прод', () => {
    // Замер: запрос ?sub=Cosmex%20Professional → canonical ?sub=Cosmex+Professional
    const canonicalFromProd = '/catalog/produktsiya-cosmex?sub=Cosmex+Professional'
    assert.equal(buildCatalogUrl('produktsiya-cosmex', { sub: 'Cosmex Professional' }), canonicalFromProd)
  })

  it('кодирует кириллицу и запятые как URLSearchParams', () => {
    const url = buildCatalogUrl('dlya-manikyura-i-pedikyura', {
      sub: 'Гель-лаки, базы, топы, праймеры',
    })
    assert.ok(!url.includes('%20'), 'не должно быть %20')
    assert.ok(url.includes('+'), 'пробелы кодируются как +')
  })

  it('порядок параметров стабилен: sub перед page', () => {
    const a = buildCatalogUrl('x', { page: 2, sub: 'A B' })
    const b = buildCatalogUrl('x', { sub: 'A B', page: 2 })
    assert.equal(a, b)
    assert.equal(a, '/catalog/x?sub=A+B&page=2')
  })

  it('прочие параметры идут после известных, по алфавиту', () => {
    assert.equal(buildQuery({ zeta: '1', alpha: '2', sub: 'S' }), 'sub=S&alpha=2&zeta=1')
  })
})

describe('page=1 не попадает в URL', () => {
  it('опускает page=1 — иначе лишний 301-хоп для краулера', () => {
    assert.equal(buildCatalogUrl('gel-laki', { page: 1 }), '/catalog/gel-laki')
    assert.equal(buildPageUrl('/catalog/gel-laki', {}, 1), '/catalog/gel-laki')
  })

  it('page ≥ 2 остаётся', () => {
    assert.equal(buildPageUrl('/catalog/gel-laki', {}, 2), '/catalog/gel-laki?page=2')
  })

  it('пустые значения отбрасываются', () => {
    assert.equal(buildCatalogUrl('x', { sub: '', page: undefined }), '/catalog/x')
  })
})

describe('P1-6: пагинация не уходит на чужой путь', () => {
  it('строится от текущего пути, а не от родительской категории', () => {
    // На проде: /catalog/gel-laki ссылается на
    // /catalog/dlya-manikyura-i-pedikyura?page=2&sub=Гель-лаки…
    const url = buildPageUrl('/catalog/gel-laki', { sub: 'Гель-лаки, базы, топы, праймеры' }, 2)
    assert.ok(url.startsWith('/catalog/gel-laki?'), `ушли на чужой путь: ${url}`)
    assert.ok(url.includes('page=2'))
  })

  it('сохраняет остальные параметры при смене страницы', () => {
    const url = buildPageUrl('/catalog/x', { sub: 'A B', page: 5 }, 3)
    assert.equal(url, '/catalog/x?sub=A+B&page=3')
  })
})

describe('вспомогательное', () => {
  it('buildCatalogUrl без slug даёт /catalog', () => {
    assert.equal(buildCatalogUrl(undefined), '/catalog')
  })

  it('buildBrandUrl', () => {
    assert.equal(buildBrandUrl('cosmolac'), '/brand/cosmolac')
  })

  it('absolute не трогает уже абсолютные URL', () => {
    assert.equal(absolute('/brand'), 'https://cosmex.ru/brand')
    assert.equal(absolute('https://cosmex.ru/x'), 'https://cosmex.ru/x')
  })
})
