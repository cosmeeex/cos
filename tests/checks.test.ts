import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDocument, trafficLight, type DocumentView } from "../src/guard/checks.ts";
import { GS } from "../src/core/gs1.ts";

const GTIN = "04006381333931";
const code = (serial: string) =>
  `01${GTIN}21${serial.padEnd(13, "0")}${GS}91EE06${GS}92dGVzdENyeXB0b1RhaWxCYXNlNjRWYWx1ZT09`;

const gelPolish = (over: Partial<DocumentView["positions"][0]> = {}) => ({
  name: "Гель-лак COSMEX №1, 8 мл",
  pathName: "Гель-лаки",
  trackingType: "CHEMISTRY",
  quantity: 2,
  trackingCodes: [code("SER0000000001"), code("SER0000000002")],
  gtins: [GTIN],
  ...over,
});

test("розничная продажа маркируемого без кодов — предупреждение (переходный период)", () => {
  const findings = checkDocument({
    docType: "retaildemand",
    positions: [gelPolish({ trackingCodes: [] })],
  });
  assert.ok(findings.some((f) => f.code === "NO_CODES_ON_OUTBOUND" && f.severity === "warn"));
  assert.equal(trafficLight(findings), "yellow");
});

test("кодов меньше количества — предупреждение с точным дефицитом", () => {
  const findings = checkDocument({
    docType: "demand",
    positions: [gelPolish({ trackingCodes: [code("SER0000000001")] })],
  });
  const f = findings.find((x) => x.code === "CODES_LESS_THAN_QTY");
  assert.ok(f);
  assert.equal(f!.severity, "warn");
  assert.match(f!.action, /1 шт/);
});

test("кодов больше количества — блок", () => {
  const findings = checkDocument({
    docType: "demand",
    positions: [gelPolish({ quantity: 1 })],
  });
  assert.ok(findings.some((f) => f.code === "CODES_MORE_THAN_QTY"));
});

test("полный комплект кодов — зелёный", () => {
  const findings = checkDocument({ docType: "demand", positions: [gelPolish()] });
  assert.equal(trafficLight(findings), "green");
});

test("дубль кода в документе — блок", () => {
  const findings = checkDocument({
    docType: "demand",
    positions: [gelPolish({ trackingCodes: [code("SER0000000001"), code("SER0000000001")] })],
  });
  assert.ok(findings.some((f) => f.code === "DUPLICATE_CODE"));
});

test("пересорт: код чужого GTIN — блок", () => {
  const alien = `0104006381333948` + `21SER0000000009${GS}91EE06${GS}92dGVzdENyeXB0b1RhaWxCYXNlNjRWYWx1ZT09`;
  const findings = checkDocument({
    docType: "retaildemand",
    positions: [gelPolish({ quantity: 1, trackingCodes: [alien] })],
  });
  // Чужой GTIN либо не проходит контрольную цифру, либо не совпадает с карточкой.
  assert.ok(findings.some((f) => f.code === "GTIN_MISMATCH" || f.code === "BAD_CODE"));
  assert.equal(trafficLight(findings), "red");
});

test("списание маркируемого — предупреждение о выводе из оборота", () => {
  const findings = checkDocument({
    docType: "loss",
    positions: [gelPolish({ trackingCodes: [] })],
  });
  assert.ok(findings.some((f) => f.code === "LOSS_NEEDS_RETIRE" && f.severity === "warn"));
  assert.equal(trafficLight(findings), "yellow");
});

test("приёмка маркируемого без кодов — предупреждение про ЭДО", () => {
  const findings = checkDocument({
    docType: "supply",
    positions: [gelPolish({ trackingCodes: [] })],
  });
  const f = findings.find((x) => x.code === "INBOUND_WITHOUT_CODES");
  assert.ok(f);
  assert.equal(f!.severity, "warn");
});

test("коды есть, а признака в карточке нет — предупреждение; без кодов — тишина", () => {
  const withCodes = checkDocument({
    docType: "supply",
    positions: [gelPolish({ trackingType: "NOT_TRACKED" })],
  });
  assert.ok(withCodes.some((f) => f.code === "CARD_NOT_TRACKED"));
  const noCodes = checkDocument({
    docType: "supply",
    positions: [gelPolish({ trackingType: "NOT_TRACKED", trackingCodes: [] })],
  });
  assert.ok(!noCodes.some((f) => f.code === "CARD_NOT_TRACKED"));
});

test("немаркируемый товар не трогаем", () => {
  const findings = checkDocument({
    docType: "retaildemand",
    positions: [
      {
        name: "Фреза алмазная пламя",
        trackingType: "NOT_TRACKED",
        quantity: 5,
        trackingCodes: [],
      },
    ],
  });
  assert.equal(findings.length, 0);
  assert.equal(trafficLight(findings), "green");
});

test("розничная продажа: касса сохраняет обрезанный код — НЕ ошибка (ККТ/ЧЗ уже проверили)", () => {
  // Касса МойСклад пишет в retaildemand серийник 6 симв. и без криптохвоста.
  const findings = checkDocument({
    docType: "retaildemand",
    positions: [
      gelPolish({ quantity: 2, trackingCodes: [`01${GTIN}21A1B2C3`, `01${GTIN}21D4E5F6`] }),
    ],
  });
  assert.ok(!findings.some((f) => f.code === "BAD_CODE" || f.code === "TRUNCATED_CODE"));
  assert.equal(trafficLight(findings), "green");
});

test("отгрузка с сокращённым кодом — предупреждение, не блок", () => {
  const findings = checkDocument({
    docType: "demand",
    positions: [gelPolish({ quantity: 1, trackingCodes: [`01${GTIN}21A1B2C3`] })],
  });
  const f = findings.find((x) => x.code === "TRUNCATED_CODE");
  assert.ok(f);
  assert.equal(f!.severity, "warn");
  assert.equal(trafficLight(findings), "yellow");
});

test("битый скан в позиции — блок с инструкцией", () => {
  const findings = checkDocument({
    docType: "retaildemand",
    positions: [gelPolish({ quantity: 1, trackingCodes: ["мусор-не-код"] })],
  });
  const f = findings.find((x) => x.code === "BAD_CODE");
  assert.ok(f);
  assert.match(f!.action, /карантин/);
});
