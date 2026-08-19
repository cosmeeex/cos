import { test } from "node:test";
import assert from "node:assert/strict";
import { auditProduct, auditAll, renderAuditMarkdown, extractGtins } from "../src/classifier/audit.ts";

const NOW = new Date("2026-08-19");

test("маркируемый товар без признака и без GTIN — три проблемы", () => {
  const row = auditProduct(
    { id: "1", name: "Гель-лак BSG №5, 8 мл", trackingType: "NOT_TRACKED", barcodes: [] },
    NOW,
  );
  const codes = row.issues.map((i) => i.code);
  assert.ok(codes.includes("TRACKING_TYPE_MISSING"));
  assert.ok(codes.includes("TNVED_MISSING"));
  assert.ok(codes.includes("GTIN_MISSING"));
});

test("корректная карточка проходит без замечаний", () => {
  const row = auditProduct(
    {
      id: "2",
      name: "Шампунь Kapous 1000 мл",
      trackingType: "CHEMISTRY",
      tnved: "3305100000",
      barcodes: [{ ean13: "4006381333931" }],
    },
    NOW,
  );
  assert.deepEqual(row.issues, []);
});

test("битый штрихкод ловится", () => {
  const row = auditProduct(
    {
      id: "3",
      name: "Крем для рук MILV 40 мл",
      trackingType: "CHEMISTRY",
      tnved: "3304990000",
      barcodes: [{ ean13: "4006381333932" }],
    },
    NOW,
  );
  assert.ok(row.issues.some((i) => i.code === "GTIN_INVALID"));
});

test("лишний признак маркировки у фрезы", () => {
  const row = auditProduct(
    { id: "4", name: "Фреза алмазная пламя", trackingType: "CHEMISTRY", barcodes: [] },
    NOW,
  );
  assert.ok(row.issues.some((i) => i.code === "TRACKING_TYPE_EXCESS"));
});

test("товар будущей волны (пинцет) сейчас замечаний не требует", () => {
  const row = auditProduct(
    { id: "5", name: "Пинцет для бровей Staleks", trackingType: "NOT_TRACKED", barcodes: [] },
    NOW,
  );
  assert.ok(!row.issues.some((i) => i.code === "TRACKING_TYPE_MISSING"));
});

test("auditAll агрегирует и пропускает архив", () => {
  const report = auditAll(
    [
      { id: "1", name: "Гель-лак №1", trackingType: "NOT_TRACKED", barcodes: [] },
      { id: "2", name: "Гель-лак №2 (архив)", archived: true, trackingType: "NOT_TRACKED" },
      { id: "3", name: "Фреза керамическая", trackingType: "NOT_TRACKED" },
    ],
    NOW,
  );
  assert.equal(report.total, 2);
  assert.equal(report.tracked, 1);
  assert.ok(report.byIssue["TRACKING_TYPE_MISSING"] >= 1);
  const md = renderAuditMarkdown(report);
  assert.match(md, /Гель-лак №1/);
  assert.doesNotMatch(md, /архив/);
});

test("extractGtins нормализует и дедуплицирует", () => {
  const gtins = extractGtins({
    id: "9",
    name: "x",
    barcodes: [{ ean13: "4006381333931" }, { gtin: "04006381333931" }, { code128: "ABC" }],
  });
  assert.deepEqual(gtins, ["04006381333931"]);
});
