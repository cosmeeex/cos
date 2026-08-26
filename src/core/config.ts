/**
 * Конфигурация интеграции. Источники: переменные окружения + файл .env в корне.
 * Никаких секретов в коде и в git — только через окружение.
 */
import { readFileSync, existsSync } from "node:fs";

export interface AppConfig {
  /** МойСклад JSON API 1.2 */
  moysklad: {
    baseUrl: string;
    /** Токен доступа (предпочтительно) — Настройки → Обмен данными → Токены. */
    token: string | null;
    /** Логин/пароль — запасной вариант, если токен не выдан. */
    login: string | null;
    password: string | null;
  };
  /** Честный знак (ГИС МТ) */
  crpt: {
    /** true = песочница (демо-контур), false = продуктив. */
    sandbox: boolean;
    trueApiUrl: string;
    suzUrl: string;
    /** OMS ID из личного кабинета СУЗ (для заказа кодов). */
    omsId: string | null;
    /** Клиентский токен СУЗ (OMS connection token). */
    omsToken: string | null;
    /** Команда внешнего подписанта УКЭП, см. crpt/signer.ts. */
    signerCmd: string | null;
    /** Отпечаток сертификата УКЭП (thumbprint) для подписанта. */
    certThumbprint: string | null;
    /** ИНН участника оборота. */
    inn: string | null;
  };
  telegram: {
    botToken: string | null;
    chatId: string | null;
  };
  server: {
    port: number;
    /** Секрет, которым МойСклад подписывает вебхуки (проверяем свой URL-суффикс). */
    webhookSecret: string;
    /** Секрет офисного подписанта (agent.ps1) для /sign/*. */
    signerSecret: string;
  };
  /** dry-run: все записывающие вызовы только логируются, ничего не отправляется. */
  dryRun: boolean;
}

/** Разбор строки .env (KEY=value, поддержка кавычек и комментариев). */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseDotEnv(readFileSync(path, "utf8"));
}

/** Собирает конфиг: process.env приоритетнее .env. */
export function loadConfig(envFilePath = ".env", env: Record<string, string | undefined> = process.env): AppConfig {
  const file = readEnvFile(envFilePath);
  const get = (key: string): string | null => env[key] ?? file[key] ?? null;
  const sandbox = (get("CRPT_SANDBOX") ?? "true") !== "false";

  return {
    moysklad: {
      baseUrl: get("MOYSKLAD_BASE_URL") ?? "https://api.moysklad.ru/api/remap/1.2",
      token: get("MOYSKLAD_TOKEN"),
      login: get("MOYSKLAD_LOGIN"),
      password: get("MOYSKLAD_PASSWORD"),
    },
    crpt: {
      sandbox,
      trueApiUrl:
        get("CRPT_TRUE_API_URL") ??
        (sandbox ? "https://markirovka.sandbox.crptech.ru/api/v3/true-api" : "https://markirovka.crpt.ru/api/v3/true-api"),
      suzUrl:
        get("CRPT_SUZ_URL") ??
        (sandbox ? "https://suz.sandbox.crptech.ru/api/v3" : "https://suzgrid.crpt.ru/api/v3"),
      omsId: get("CRPT_OMS_ID"),
      omsToken: get("CRPT_OMS_TOKEN"),
      signerCmd: get("CRPT_SIGNER_CMD"),
      certThumbprint: get("CRPT_CERT_THUMBPRINT"),
      inn: get("CRPT_INN"),
    },
    telegram: {
      botToken: get("TELEGRAM_BOT_TOKEN"),
      chatId: get("TELEGRAM_CHAT_ID"),
    },
    server: {
      port: Number(get("PORT") ?? "8787"),
      webhookSecret: get("WEBHOOK_SECRET") ?? "",
      signerSecret: get("SIGNER_SECRET") ?? "",
    },
    dryRun: (get("DRY_RUN") ?? "true") !== "false",
  };
}

/** Проверка достаточности конфига для конкретного сценария. */
export function requireFor(cfg: AppConfig, scenario: "moysklad" | "trueapi" | "suz" | "telegram"): string[] {
  const missing: string[] = [];
  switch (scenario) {
    case "moysklad":
      if (!cfg.moysklad.token && !(cfg.moysklad.login && cfg.moysklad.password)) {
        missing.push("MOYSKLAD_TOKEN (или MOYSKLAD_LOGIN + MOYSKLAD_PASSWORD)");
      }
      break;
    case "trueapi":
      // Подпись: либо локальная команда КриптоПро, либо офисный подписант.
      if (!cfg.crpt.signerCmd && !cfg.server.signerSecret) {
        missing.push("CRPT_SIGNER_CMD или SIGNER_SECRET (офисный подписант)");
      }
      break;
    case "suz":
      if (!cfg.crpt.omsId) missing.push("CRPT_OMS_ID");
      if (!cfg.crpt.omsToken) missing.push("CRPT_OMS_TOKEN");
      break;
    case "telegram":
      if (!cfg.telegram.botToken) missing.push("TELEGRAM_BOT_TOKEN");
      if (!cfg.telegram.chatId) missing.push("TELEGRAM_CHAT_ID");
      break;
  }
  return missing;
}
