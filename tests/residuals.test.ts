import { test } from "node:test";
import assert from "node:assert/strict";
import { planResiduals, CODE_PRICE_RUB } from "../src/residuals/plan.ts";
import { toZpl, toCsv } from "../src/residuals/labels.ts";
import { GS } from "../src/core/gs1.ts";

const item = (n: number, over = {}) => ({
  productId: `p${n}`,
  name: `Гель-лак №${n}`,
  gtin: "04006381333931",
  quantity: 10,
  trackingType: "CHEMISTRY",
  emissionType: "REMAINS" as const,
  ...over,
});

test("товар без GTIN отклоняется с понятной причиной", () => {
  const plan = planResiduals([item(1, { gtin: null })]);
  assert.equal(plan.batches.length, 0);
  assert.equal(plan.rejected.length, 1);
  assert.match(plan.rejected[0].reason, /GTIN/);
});

test("больше 1000 кодов на позицию режется на части", () => {
  const plan = planResiduals([item(1, { quantity: 2500 })]);
  const quantities = plan.batches.flatMap((b) => b.positions.map((p) => p.quantity));
  assert.deepEqual(quantities, [1000, 1000, 500]);
  assert.equal(plan.totalCodes, 2500);
});

test("больше 10 позиций раскладывается по нескольким заказам", () => {
  const plan = planResiduals(Array.from({ length: 23 }, (_, i) => item(i)));
  assert.equal(plan.batches.length, 3);
  assert.deepEqual(plan.batches.map((b) => b.positions.length), [10, 10, 3]);
});

test("разные способы ввода не смешиваются в одном заказе", () => {
  const plan = planResiduals([item(1), item(2, { emissionType: "FOREIGN" })]);
  assert.equal(plan.batches.length, 2);
  const types = plan.batches.map((b) => b.emissionType).sort();
  assert.deepEqual(types, ["FOREIGN", "REMAINS"]);
});

test("стоимость кодов считается по 0,61 ₽", () => {
  const plan = planResiduals([item(1, { quantity: 100 })]);
  assert.equal(plan.estimatedCostRub, Math.round(100 * CODE_PRICE_RUB * 100) / 100);
});

test("ZPL: DataMatrix c GS как _1D и UTF-8 для кириллицы", () => {
  const code = `0104006381333931215UYqQ4WKcVAM7${GS}91EE06${GS}92dGVzdENyeXB0b1RhaWxCYXNlNjRWYWx1ZT09`;
  const zpl = toZpl([{ code, productName: "Гель-лак №1", gtin: "04006381333931" }]);
  assert.match(zpl, /\^BXN/);
  assert.match(zpl, /_1D91EE06_1D92/);
  assert.match(zpl, /\^CI28/);
  assert.match(zpl, /Гель-лак №1/);
});

test("CSV: identity и serial извлекаются", () => {
  const code = `0104006381333931215UYqQ4WKcVAM7${GS}91EE06${GS}92dGVzdENyeXB0b1RhaWxCYXNlNjRWYWx1ZT09`;
  const csv = toCsv([{ code, productName: "Гель-лак", gtin: "" }]);
  assert.match(csv, /"0104006381333931215UYqQ4WKcVAM7"/);
  assert.match(csv, /"5UYqQ4WKcVAM7"/);
  assert.match(csv, /"04006381333931"/);
});
