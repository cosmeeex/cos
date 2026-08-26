import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dupName,
  isDupName,
  parseDupCsv,
  planDuplicates,
  dupHealth,
} from "../src/residuals/duplicates.ts";

test("dupName идемпотентен", () => {
  assert.equal(dupName("Гель-лак №1"), "Гель-лак №1 (немарк.)");
  assert.equal(dupName("Гель-лак №1 (немарк.)"), "Гель-лак №1 (немарк.)");
  assert.ok(isDupName("Шампунь (немарк.)"));
  assert.ok(!isDupName("Шампунь"));
});

test("parseDupCsv: точки с запятой в названии, комментарии, дробные", () => {
  const reqs = parseDupCsv(
    ["# ходовые остатки", "Гель-лак BSG; синий №5, 8 мл;12", "Шампунь Kapous 1000 мл;3,0", "", "битая строка"].join("\n"),
  );
  assert.deepEqual(reqs, [
    { name: "Гель-лак BSG; синий №5, 8 мл", quantity: 12 },
    { name: "Шампунь Kapous 1000 мл", quantity: 3 },
  ]);
});

const products = [
  { id: "1", name: "Гель-лак №1", stock: 20 },
  { id: "2", name: "Гель-лак №2", stock: 5 },
  { id: "3", name: "Гель-лак №2 (немарк.)", stock: 0 },
];

test("planDuplicates: создание, повторное использование, перенос", () => {
  const actions = planDuplicates(
    [
      { name: "Гель-лак №1", quantity: 10 },
      { name: "Гель-лак №2", quantity: 5 },
    ],
    products,
  );
  assert.deepEqual(
    actions.map((a) => a.kind),
    ["create_dup", "transfer", "reuse_dup", "transfer"],
  );
});

test("planDuplicates: отказы — нет карточки, мало остатка, сам дубль", () => {
  const actions = planDuplicates(
    [
      { name: "Неизвестный товар", quantity: 1 },
      { name: "Гель-лак №2", quantity: 99 },
      { name: "Гель-лак №2 (немарк.)", quantity: 1 },
    ],
    products,
  );
  assert.ok(actions.every((a) => a.kind === "reject"));
  assert.match(actions[1].reason!, /остаток 5/);
});

test("dupHealth: архив пустых, пометка долгожителей", () => {
  const now = new Date("2026-08-26");
  const health = dupHealth(
    [
      { name: "А (немарк.)", stock: 0 },
      { name: "Б (немарк.)", stock: 7, createdAt: "2026-05-01" },
      { name: "В (немарк.)", stock: 3, createdAt: "2026-08-20" },
    ],
    now,
  );
  assert.deepEqual(health.map((h) => h.verdict), ["archive", "stale", "ok"]);
});
