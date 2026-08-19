/**
 * Подписание данных УКЭП (ГОСТ Р 34.10-2012) для авторизации в True API и СУЗ.
 *
 * Криптография не реализуется в этом процессе: подпись делает внешняя команда
 * (КриптоПро `cryptcp`, `csptest`, openssl с gost-engine или свой скрипт) на
 * машине, где установлен сертификат УКЭП. Интеграция вызывает её через stdin/stdout.
 *
 * Контракт команды (CRPT_SIGNER_CMD в .env):
 *   - на stdin подаётся подписываемая строка (UTF-8);
 *   - на stdout ожидается ОТСОЕДИНЁННАЯ ЛИБО ПРИСОЕДИНЁННАЯ CMS/PKCS#7-подпись в base64
 *     (True API принимает присоединённую подпись данных в base64);
 *   - код возврата 0 = успех.
 * Плейсхолдер {thumbprint} заменяется на CRPT_CERT_THUMBPRINT.
 *
 * Пример для КриптоПро на Linux:
 *   CRPT_SIGNER_CMD="/opt/cprocsp/bin/amd64/cryptcp -signf -thumbprint {thumbprint} -der -strict -cert -detached=no -pipe"
 */
import { spawn } from "node:child_process";

export interface Signer {
  /** Возвращает подпись данных в base64 (присоединённая CMS). */
  sign(data: string): Promise<string>;
}

export class ExternalSigner implements Signer {
  private readonly command: string;
  private readonly thumbprint: string | null;

  constructor(command: string, thumbprint: string | null) {
    this.command = command;
    this.thumbprint = thumbprint;
  }

  sign(data: string): Promise<string> {
    const cmd = this.command.replaceAll("{thumbprint}", this.thumbprint ?? "");
    return new Promise((resolve, reject) => {
      const child = spawn("/bin/sh", ["-c", cmd], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(out.trim().replace(/\s+/g, ""));
        else reject(new Error(`Подписант завершился с кодом ${code}: ${err.slice(0, 500)}`));
      });
      child.stdin.write(data, "utf8");
      child.stdin.end();
    });
  }
}

/** Заглушка для тестов и dry-run: «подпись» = base64 данных с префиксом. */
export class StubSigner implements Signer {
  async sign(data: string): Promise<string> {
    return "STUB." + Buffer.from(data, "utf8").toString("base64");
  }
}
