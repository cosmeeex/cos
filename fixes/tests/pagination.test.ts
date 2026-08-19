import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  lastPageOf,
  normalizePage,
  paginationRelLinks,
  resolvePage,
} from '../src/lib/seo/pagination.ts'

describe('normalizePage', () => {
  it('принимает валидные номера', () => {
    assert.equal(normalizePage('2'), 2)
    assert.equal(normalizePage(7), 7)
    assert.equal(normalizePage('999'), 999)
  })

  it('схлопывает в 1 всё, что не целое положительное', () => {
    // Ровно те значения, что проверялись на проде.
    for (const bad of ['0', '-5', 'abc', '1e9', '2.5', '', ' ', '+3', '0x10']) {
      assert.equal(normalizePage(bad), 1, `ожидалась 1 для ${JSON.stringify(bad)}`)
    }
  })

  it('1e9 не проходит как число, хотя Number() его понимает', () => {
    assert.equal(Number('1e9'), 1_000_000_000) // подтверждаем ловушку
    assert.equal(normalizePage('1e9'), 1)
  })

  it('берёт первое значение при повторяющемся параметре', () => {
    assert.equal(normalizePage(['3', '9']), 3)
  })

  it('не падает на мусорных типах', () => {
    assert.equal(normalizePage(undefined), 1)
    assert.equal(normalizePage(null), 1)
    assert.equal(normalizePage({}), 1)
  })
})

describe('lastPageOf', () => {
  it('считает по 30 на страницу', () => {
    assert.equal(lastPageOf(0), 1)
    assert.equal(lastPageOf(1), 1)
    assert.equal(lastPageOf(30), 1)
    assert.equal(lastPageOf(31), 2)
    assert.equal(lastPageOf(300), 10)
  })
})

describe('P0-2: страница за пределом диапазона — 404, а не пустой 200', () => {
  const total = 300 // 10 страниц по 30

  it('валидная страница отдаётся', () => {
    assert.deepEqual(resolvePage({ raw: '2', total }), { kind: 'ok', page: 2, lastPage: 10 })
    assert.equal(resolvePage({ raw: '10', total }).kind, 'ok')
  })

  it('за пределом диапазона — notFound', () => {
    // Точно те значения, что на проде отдают 200 + index,follow + self-canonical.
    for (const bad of ['11', '50', '999', '99999']) {
      assert.equal(
        resolvePage({ raw: bad, total }).kind,
        'notFound',
        `?page=${bad} должен быть 404`,
      )
    }
  })

  it('1e9 схлопывается в 1 и редиректится, а не улетает в notFound', () => {
    assert.equal(resolvePage({ raw: '1e9', total }).kind, 'redirect')
  })

  it('лишний или невалидный параметр — редирект на адрес без ?page=', () => {
    for (const p of ['1', '0', '-5', 'abc']) {
      assert.equal(resolvePage({ raw: p, total }).kind, 'redirect', `?page=${p} должен быть 301`)
    }
  })

  it('без параметра — обычная первая страница, без редиректа', () => {
    assert.deepEqual(resolvePage({ raw: undefined, total }), { kind: 'ok', page: 1, lastPage: 10 })
  })

  it('пустая категория: первая страница валидна, вторая — 404', () => {
    assert.equal(resolvePage({ raw: undefined, total: 0 }).kind, 'ok')
    assert.equal(resolvePage({ raw: '2', total: 0 }).kind, 'notFound')
  })

  it('уважает нестандартный perPage', () => {
    assert.equal(resolvePage({ raw: '3', total: 100, perPage: 50 }).kind, 'notFound')
    assert.equal(resolvePage({ raw: '2', total: 100, perPage: 50 }).kind, 'ok')
  })
})

describe('rel=prev / rel=next', () => {
  const buildUrl = (n: number) =>
    n === 1 ? 'https://cosmex.ru/catalog/x' : `https://cosmex.ru/catalog/x?page=${n}`

  it('на первой странице только next', () => {
    assert.deepEqual(paginationRelLinks({ page: 1, lastPage: 5, buildUrl }), {
      next: 'https://cosmex.ru/catalog/x?page=2',
    })
  })

  it('prev со второй страницы ведёт на базовый URL без ?page=1', () => {
    const { prev } = paginationRelLinks({ page: 2, lastPage: 5, buildUrl })
    assert.equal(prev, 'https://cosmex.ru/catalog/x')
  })

  it('на последней странице только prev', () => {
    assert.deepEqual(paginationRelLinks({ page: 5, lastPage: 5, buildUrl }), {
      prev: 'https://cosmex.ru/catalog/x?page=4',
    })
  })

  it('единственная страница — ни prev, ни next', () => {
    assert.deepEqual(paginationRelLinks({ page: 1, lastPage: 1, buildUrl }), {})
  })
})
