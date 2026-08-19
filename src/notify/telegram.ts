/**
 * Уведомления менеджерам в Telegram: блокирующие находки стража,
 * расхождения сверки, дедлайны. Без токена работает как консольный логгер.
 */
import type { AppConfig } from "../core/config.ts";

export interface Notifier {
  send(text: string): Promise<void>;
}

export class TelegramNotifier implements Notifier {
  private readonly botToken: string;
  private readonly chatId: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  async send(text: string): Promise<void> {
    // Telegram ограничивает сообщение 4096 символами.
    for (let i = 0; i < text.length; i += 4000) {
      const chunk = text.slice(i, i + 4000);
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text: chunk, disable_web_page_preview: true }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Telegram API: HTTP ${res.status} ${body.slice(0, 300)}`);
      }
    }
  }
}

export class ConsoleNotifier implements Notifier {
  async send(text: string): Promise<void> {
    console.log(`[уведомление]\n${text}`);
  }
}

export function makeNotifier(cfg: AppConfig): Notifier {
  if (cfg.telegram.botToken && cfg.telegram.chatId && !cfg.dryRun) {
    return new TelegramNotifier(cfg.telegram.botToken, cfg.telegram.chatId);
  }
  return new ConsoleNotifier();
}
