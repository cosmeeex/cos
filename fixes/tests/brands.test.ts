import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { brandKey, brandLandingSlug } from '../src/lib/seo/brands.ts'
import { buildBrandUrl, buildCatalogUrl } from '../src/lib/seo/url.ts'

describe('P1-5: чипы брендов ведут на индексируемые страницы', () => {
  it('находит посадочную для брендов, у которых она есть', () => {
    // Все девять проверены на проде: HTTP 200.
    assert.equal(brandLandingSlug('CosmoLac'), 'cosmolac')
    assert.equal(brandLandingSlug('Staleks'), 'staleks')
    assert.equal(brandLandingSlug('Planet Nails'), 'planet-nails')
    assert.equal(brandLandingSlug('ADRICOCO'), 'adricoco')
  })

  it('регистр и лишние пробелы не мешают', () => {
    assert.equal(brandLandingSlug('  cosmolac '), 'cosmolac')
    assert.equal(brandLandingSlug('PLANET   NAILS'), 'planet-nails')
    assert.equal(brandKey('  Planet   Nails '), 'planet nails')
  })

  it('для брендов без посадочной возвращает null', () => {
    for (const b of ['BSG', 'Grattol', 'Луи Филипп', 'Опция']) {
      assert.equal(brandLandingSlug(b), null, b)
    }
  })

  it('ссылка на бренд с посадочной не содержит закрытых в robots параметров', () => {
    const href = buildBrandUrl(brandLandingSlug('CosmoLac')!)
    assert.equal(href, '/brand/cosmolac')
    assert.ok(!/[?&](brand|search)=/.test(href))
  })

  it('без посадочной остаётся фильтр — его помечают nofollow в BrandChip', () => {
    const href = buildCatalogUrl('gel-laki', { brand: 'BSG' })
    assert.equal(href, '/catalog/gel-laki?brand=BSG')
  })
})
