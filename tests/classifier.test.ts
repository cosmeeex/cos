import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, obligationOn, waveById, waveByTnved, WAVES } from "../src/classifier/rules.ts";

const NOW = new Date("2026-08-19");

test("гель-лак → волна 3 косметики (3304), CHEMISTRY, уже обязательна", () => {
  const c = classify({ name: "Гель-лак COSMEX Professional №112, 8 мл", pathName: "Для маникюра и педикюра / Гель-лаки" });
  assert.equal(c.wave?.id, "beauty-2025-w3");
  assert.equal(c.wave?.trackingType, "CHEMISTRY");
  assert.equal(obligationOn(c.wave!, NOW).markingMandatory, true);
});

test("база и топ для гель-лака → волна 3", () => {
  assert.equal(classify({ name: "Камуфлирующая база KIRA Rubber Base 15 мл" }).wave?.id, "beauty-2025-w3");
  assert.equal(classify({ name: "Топ для гель-лака без липкого слоя" }).wave?.id, "beauty-2025-w3");
});

test("шампунь и крем-краска → волна 2 (средства для волос)", () => {
  assert.equal(classify({ name: "Шампунь COSMEX OverDose Keratin 1000 мл" }).wave?.id, "beauty-2025-w2");
  assert.equal(classify({ name: "Kapous крем-краска 8.1, 100 мл" }).wave?.id, "beauty-2025-w2");
});

test("гель для душа и мыло → волна 1", () => {
  assert.equal(classify({ name: "COSMEX NOIR гель для душа Oakmoss Amber 300 мл" }).wave?.id, "beauty-2025-w1");
  assert.equal(classify({ name: "Мыло жидкое для рук NOIR 500 мл" }).wave?.id, "beauty-2025-w1");
});

test("духи → парфюмерия, продажа немаркированных запрещена", () => {
  const c = classify({ name: "Духи неведомого бренда 50 мл" });
  assert.equal(c.wave?.id, "perfumery-2020");
  assert.equal(obligationOn(c.wave!, NOW).salesBanned, true);
});

test("антисептик → своя группа SANITIZER", () => {
  const c = classify({ name: "Кожный антисептик Алмадез-экспресс 250 мл" });
  assert.equal(c.group, "antiseptics");
  assert.equal(c.wave?.trackingType, "SANITIZER");
});

test("пинцет и расчёска → волна гигиены 2026, пока не обязательна", () => {
  const c = classify({ name: "Пинцет для бровей Staleks TE-11" });
  assert.equal(c.wave?.id, "hygiene-2026");
  assert.equal(obligationOn(c.wave!, NOW).markingMandatory, false);
  assert.equal(obligationOn(c.wave!, new Date("2026-11-02")).markingMandatory, true);
  assert.equal(classify({ name: "Расческа карбоновая для стрижки" }).wave?.id, "hygiene-2026");
});

test("фрезы, лампы, стразы → не подлежат маркировке", () => {
  for (const name of [
    "Фреза алмазная пламя синяя",
    "Лампа UV/LED SUN 5 48W",
    "Стразы для дизайна ногтей SS6 Crystal",
    "Кусачки для кутикулы Staleks Pro",
    "Крафт-пакеты для стерилизации 75×150",
  ]) {
    const c = classify({ name });
    assert.equal(c.group, "none", name);
  }
});

test("ТН ВЭД приоритетнее ключевых слов", () => {
  // Название «крем» намекает на 3304, но ТН ВЭД говорит «свечи» (не маркируется).
  const c = classify({ name: "Крем-свеча массажная", tnved: "3406000000" });
  assert.equal(c.group, "none");
  assert.equal(c.confidence, 0.95);
  // И наоборот: по ТН ВЭД 3303 парфюмерия при любом названии.
  assert.equal(classify({ name: "Загадочный продукт", tnved: "3303001000" }).wave?.id, "perfumery-2020");
});

test("waveByTnved выбирает самый специфичный префикс", () => {
  assert.equal(waveByTnved("3808940000")?.id, "antiseptics-2024");
  assert.equal(waveByTnved("3401110001")?.id, "beauty-2025-w1");
  assert.equal(waveByTnved("9999999999"), null);
});

test("мист (неспиртовой, подтверждено владельцем) → косметика, не парфюмерия", () => {
  const c = classify({ name: "COSMEX NOIR Parfumed Mist Amber Rouge по мотивам Baccarat 250 мл" });
  assert.equal(c.special, "perfumed-mist");
  assert.equal(c.group, "beauty");
  assert.equal(c.wave?.id, "beauty-2025-w2");
  assert.ok(c.confidence >= 0.7);
  assert.ok(c.reasons.some((r) => r.includes("неспиртов")));
  // Спиртовой мист по ТН ВЭД остаётся парфюмерией.
  assert.equal(classify({ name: "Мист спиртовой", tnved: "3303001000" }).wave?.id, "perfumery-2020");
});

test("наборы помечаются как особый случай", () => {
  const c = classify({ name: "COSMEX Набор Protein шампунь + бальзам 2×1000 мл" });
  assert.equal(c.special, "set");
  assert.equal(c.wave?.id, "beauty-2025-w2");
});

test("непонятный товар — низкая уверенность, ручная проверка", () => {
  const c = classify({ name: "Штука универсальная 5 шт" });
  assert.equal(c.group, "none");
  assert.ok(c.confidence <= 0.3);
});

test("все волны имеют согласованные даты", () => {
  for (const w of WAVES) {
    assert.match(w.mandatoryFrom, /^\d{4}-\d{2}-\d{2}$/);
    if (w.salesBanFrom) assert.ok(w.salesBanFrom >= w.mandatoryFrom, w.id);
  }
  assert.ok(waveById("perfumery-2020"));
});
