import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDotEnv, loadConfig, requireFor } from "../src/core/config.ts";

test("parseDotEnv: кавычки, комментарии, пробелы", () => {
  const env = parseDotEnv(
    [
      "# комментарий",
      "MOYSKLAD_TOKEN=abc123",
      'TELEGRAM_BOT_TOKEN="123:AB C"',
      "PORT=9000 # inline-комментарий",
      "ПУСТАЯ_СТРОКА_НИЖЕ",
      "",
      "CRPT_SANDBOX=false",
    ].join("\n"),
  );
  assert.equal(env.MOYSKLAD_TOKEN, "abc123");
  assert.equal(env.TELEGRAM_BOT_TOKEN, "123:AB C");
  assert.equal(env.PORT, "9000");
  assert.equal(env.CRPT_SANDBOX, "false");
  assert.equal("ПУСТАЯ_СТРОКА_НИЖЕ" in env, false);
});

test("loadConfig: продуктив выбирает боевые URL, песочница — sandbox", () => {
  const prod = loadConfig("/nonexistent/.env", { CRPT_SANDBOX: "false" });
  assert.match(prod.crpt.trueApiUrl, /markirovka\.crpt\.ru/);
  assert.match(prod.crpt.suzUrl, /suzgrid\.crpt\.ru/);
  const sand = loadConfig("/nonexistent/.env", {});
  assert.equal(sand.crpt.sandbox, true);
  assert.match(sand.crpt.trueApiUrl, /sandbox/);
});

test("DRY_RUN по умолчанию включён — безопасность прежде всего", () => {
  const cfg = loadConfig("/nonexistent/.env", {});
  assert.equal(cfg.dryRun, true);
});

test("requireFor перечисляет недостающие настройки", () => {
  const cfg = loadConfig("/nonexistent/.env", {});
  assert.ok(requireFor(cfg, "moysklad").length > 0);
  assert.ok(requireFor(cfg, "suz").includes("CRPT_OMS_ID"));
  const withToken = loadConfig("/nonexistent/.env", { MOYSKLAD_TOKEN: "t" });
  assert.deepEqual(requireFor(withToken, "moysklad"), []);
});
