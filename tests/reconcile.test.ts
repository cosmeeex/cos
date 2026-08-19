import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile, renderReconcileMarkdown } from "../src/reconcile/stocks.ts";

const G1 = "04006381333931";
const G2 = "00000040063813";
const G3 = "01234567890128";

test("совпадающие остатки не дают расхождений", () => {
  const out = reconcile(
    [{ gtin: G1, name: "Гель-лак №1", stock: 10 }],
    [{ gtin: G1, inCirculation: 10 }],
  );
  assert.equal(out.length, 0);
});

test("кодов больше товара → зависшие выводы из оборота", () => {
  const out = reconcile(
    [{ gtin: G1, name: "Гель-лак №1", stock: 7 }],
    [{ gtin: G1, inCirculation: 10 }],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "codes_exceed_stock");
  assert.equal(out[0].delta, 3);
  assert.match(out[0].action, /15\.12\.1/);
});

test("товара больше кодов → возможно дорыночные остатки или неподписанный УПД", () => {
  const out = reconcile(
    [{ gtin: G1, name: "Шампунь", stock: 10 }],
    [{ gtin: G1, inCirculation: 4 }],
  );
  assert.equal(out[0].kind, "stock_exceeds_codes");
  assert.equal(out[0].delta, 6);
});

test("товар без единого кода и коды без товара", () => {
  const out = reconcile(
    [{ gtin: G1, name: "Крем", stock: 5 }],
    [{ gtin: G2, inCirculation: 3 }],
  );
  const kinds = out.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ["only_in_chz", "only_in_ms"]);
});

test("дубли GTIN в остатках МС агрегируются", () => {
  const out = reconcile(
    [
      { gtin: G3, name: "Тоник (осн. склад)", stock: 3 },
      { gtin: G3, name: "Тоник (розница)", stock: 2 },
    ],
    [{ gtin: G3, inCirculation: 5 }],
  );
  assert.equal(out.length, 0);
});

test("markdown-отчёт строится и сортирует по величине расхождения", () => {
  const out = reconcile(
    [
      { gtin: G1, name: "А", stock: 1 },
      { gtin: G2, name: "Б", stock: 100 },
    ],
    [
      { gtin: G1, inCirculation: 2 },
      { gtin: G2, inCirculation: 0 },
    ],
  );
  assert.equal(out[0].gtin, G2); // delta 100 первым
  const md = renderReconcileMarkdown(out, "2026-08-19");
  assert.match(md, /Расхождений: \*\*2\*\*/);
});
