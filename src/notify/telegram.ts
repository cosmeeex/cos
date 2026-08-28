/**
 * Уведомления менеджерам в Telegram: блокирующие находки стража,
 * расхождения сверки, дедлайны. Без токена работает как консольный логгер.
 *
 * Telegram может преобразовать группу в супергруппу (например, при выдаче
 * боту прав администратора) — тогда chat_id меняется. Отправлялка ловит
 * ответ migrate_to_chat_id, переезжает на новый id и запоминает его в
 * data/tg-chat-id.txt, чтобы это пережило перезапуск.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../core/config.ts";

const DATA_DIR = process.env.DATA_DIR ?? "data";
const CHAT_ID_FILE = join(DATA_DIR, "tg-chat-id.txt");

/** Актуальный chat_id: сохранённый после миграции или из конфигурации. */
export function currentChatId(cfg: AppConfig): string | null {
  try {
    const saved = readFileSync(CHAT_ID_FILE, "utf8").trim();
    if (saved) return saved;
  } catch {
    /* файла нет — берём из конфига */
  }
  return cfg.telegram.chatId;
}

export interface Notifier {
  send(text: string): Promise<void>;
}

export class TelegramNotifier implements Notifier {
  private readonly botToken: string;
  private chatId: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  async send(text: string): Promise<void> {
    // Telegram ограничивает сообщение 4096 символами.
    for (let i = 0; i < text.length; i += 4000) {
      await this.sendChunk(text.slice(i, i + 4000));
    }
  }

  private async sendChunk(chunk: string, retried = false): Promise<void> {
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text: chunk, disable_web_page_preview: true }),
    });
    if (res.ok) return;
    const body = await res.text();
    if (!retried) {
      const migrated = /"migrate_to_chat_id":\s*(-?\d+)/.exec(body)?.[1];
      if (migrated) {
        this.chatId = migrated;
        try {
          mkdirSync(DATA_DIR, { recursive: true });
          writeFileSync(CHAT_ID_FILE, migrated);
        } catch {
          /* не смогли сохранить — переезд хотя бы на время процесса */
        }
        console.warn(`Telegram: группа стала супергруппой, новый chat_id ${migrated}`);
        return this.sendChunk(chunk, true);
      }
    }
    throw new Error(`Telegram API: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
}

export class ConsoleNotifier implements Notifier {
  async send(text: string): Promise<void> {
    console.log(`[уведомление]\n${text}`);
  }
}

export function makeNotifier(cfg: AppConfig): Notifier {
  // Уведомления — не запись в учёт: работают и при DRY_RUN.
  const chatId = currentChatId(cfg);
  if (cfg.telegram.botToken && chatId) {
    return new TelegramNotifier(cfg.telegram.botToken, chatId);
  }
  return new ConsoleNotifier();
}
