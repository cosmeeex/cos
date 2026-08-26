/**
 * Очередь заданий на подпись УКЭП для «офисного подписанта».
 *
 * Сервер (Hetzner) не имеет доступа к ключу и, из-за геоблокировки СУЗ,
 * не может сам выполнять часть операций ЧЗ. Офисный компьютер с КриптоПро
 * опрашивает сервер по HTTPS (pull-модель, наружу из офиса — только исходящие
 * соединения), подписывает данные локально и возвращает подпись.
 *
 * Очередь в памяти: задания короткоживущие (минуты), при рестарте сервера
 * ожидающий вызов просто повторит запрос.
 */
import { randomUUID } from "node:crypto";

export interface SignJob {
  id: string;
  /** Данные на подпись (строка как есть — например data из /auth/key). */
  data: string;
  createdAt: number;
  takenAt: number | null;
}

interface Waiter {
  resolve: (signature: string) => void;
  reject: (err: Error) => void;
}

export class SignQueue {
  private jobs = new Map<string, SignJob>();
  private waiters = new Map<string, Waiter>();
  private readonly jobTtlMs: number;

  constructor(jobTtlMs = 5 * 60_000) {
    this.jobTtlMs = jobTtlMs;
  }

  /** Ставит данные в очередь и ждёт подпись (до timeoutMs). */
  request(data: string, timeoutMs = 90_000): Promise<string> {
    this.gc();
    const id = randomUUID();
    this.jobs.set(id, { id, data, createdAt: Date.now(), takenAt: null });
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.jobs.delete(id);
        this.waiters.delete(id);
        reject(
          new Error(
            "Офисный подписант не ответил вовремя. Проверьте, что agent.ps1 запущен на компьютере с КриптоПро.",
          ),
        );
      }, timeoutMs);
      this.waiters.set(id, {
        resolve: (sig) => {
          clearTimeout(timer);
          resolve(sig);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  /** Агент забирает пачку невзятых заданий. */
  take(max = 5): SignJob[] {
    this.gc();
    const out: SignJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.takenAt === null) {
        job.takenAt = Date.now();
        out.push(job);
        if (out.length >= max) break;
      }
    }
    return out;
  }

  /** Агент возвращает подпись (или ошибку) по заданию. */
  complete(id: string, signature: string | null, error?: string): boolean {
    const waiter = this.waiters.get(id);
    this.jobs.delete(id);
    this.waiters.delete(id);
    if (!waiter) return false;
    if (signature) waiter.resolve(signature);
    else waiter.reject(new Error(error || "подписант вернул ошибку без описания"));
    return true;
  }

  /** Сколько заданий ждёт (для /health и диагностики). */
  pending(): number {
    this.gc();
    return this.jobs.size;
  }

  private gc(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (now - job.createdAt > this.jobTtlMs) {
        this.complete(id, null, "задание протухло (TTL)");
      }
      // Взятое, но не отвеченное за 2 минуты задание возвращаем в очередь.
      if (job.takenAt !== null && now - job.takenAt > 120_000) job.takenAt = null;
    }
  }
}
