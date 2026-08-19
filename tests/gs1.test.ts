import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GS,
  normalizeScan,
  parseDataMatrix,
  isValidGtin,
  toGtin14,
  identityOf,
  sameInstance,
  toBase64Cis,
} from "../src/core/gs1.ts";

// Известный валидный EAN-13 (пример из спецификации GS1): 4006381333931.
const GTIN = "04006381333931";
const SERIAL = "ABC123def!456"; // 13 печатных символов
const FULL = `01${GTIN}21${SERIAL}${GS}91EE06${GS}92dGVzdENyeXB0b1RhaWxCYXNlNjRWYWx1ZT09`;

test("валидный полный код парфюмерии/косметики разбирается без ошибок", () => {
  const parsed = parseDataMatrix(FULL);
  assert.equal(parsed.gtin, GTIN);
  assert.equal(parsed.serial, SERIAL);
  assert.equal(parsed.identityCode, `01${GTIN}21${SERIAL}`);
  assert.deepEqual(parsed.issues, []);
});

test("контрольная цифра GTIN", () => {
  assert.equal(isValidGtin(GTIN), true);
  assert.equal(isValidGtin("04006381333932"), false);
  assert.equal(isValidGtin("123"), false);
});

test("toGtin14 дополняет EAN-13 нулём", () => {
  assert.equal(toGtin14("4006381333931"), GTIN);
  assert.equal(toGtin14("40063813"), "00000040063813");
  assert.equal(toGtin14("не-цифры"), null);
});

test("сканер: префикс FNC1 и подмена GS на видимые последовательности", () => {
  const mangled = `]d201${GTIN}21${SERIAL}\\u001d91EE06\\u001d92dGVzdENyeXB0b1RhaWxCYXNlNjRWYWx1ZT09`;
  const parsed = parseDataMatrix(mangled);
  assert.equal(parsed.gtin, GTIN);
  assert.deepEqual(parsed.issues, []);
});

test("сканер в русской раскладке чинится", () => {
  // «01…21АИС123…» — кириллица вместо латиницы в серийнике.
  const ru = `01${GTIN}21АИС123вуа!456${GS}91EE06${GS}92dGVzdENyeXB0b1RhaWxCYXNlNjRWYWx1ZT09`;
  const parsed = parseDataMatrix(ru);
  assert.equal(parsed.serial, "FBC123def!456");
  assert.deepEqual(parsed.issues, []);
});

test("код без криптохвоста помечается (для продажи нужен полный DataMatrix)", () => {
  const short = `01${GTIN}21${SERIAL}`;
  const parsed = parseDataMatrix(short);
  assert.ok(parsed.issues.some((i) => i.includes("криптохвост")));
  assert.equal(parsed.identityCode, `01${GTIN}21${SERIAL}`);
});

test("битый GTIN и короткий серийник дают находки", () => {
  const bad = `0104006381333932219ШОРТ`;
  const parsed = parseDataMatrix(bad);
  assert.ok(parsed.issues.length >= 1);
});

test("identityOf/sameInstance сравнивают экземпляры без учёта криптохвоста", () => {
  const other = `01${GTIN}21${SERIAL}${GS}91FFFF${GS}92QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWY=`;
  assert.equal(identityOf(FULL), identityOf(other));
  assert.ok(sameInstance(FULL, other));
});

test("toBase64Cis кодирует нормализованный код", () => {
  const b64 = toBase64Cis(FULL);
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), FULL);
});

test("normalizeScan убирает CR/LF по краям", () => {
  assert.equal(normalizeScan(`${FULL}\r\n`), FULL);
});
