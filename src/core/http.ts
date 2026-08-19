/**
 * HTTP-клиент поверх встроенного fetch: ретраи, таймауты, ограничение частоты.
 * МойСклад: не более 45 запросов за 3 секунды и 5 параллельных на пользователя —
 * лимитер по умолчанию настроен консервативнее.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  readonly method: string;

  constructor(status: number, url: string, body: string, method: string) {
    super(`${method} ${url} → HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
    this.method = method;
  }
}

/** Скользящее окно + ограничение параллелизма. */
export class RateLimiter {
  private timestamps: number[] = [];
  private inFlight = 0;
  private queue: Array<() => void> = [];

  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly maxParallel: number;

  constructor(maxPerWindow = 40, windowMs = 3000, maxParallel = 4) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
    this.maxParallel = maxParallel;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
      if (this.timestamps.length < this.maxPerWindow && this.inFlight < this.maxParallel) {
        this.timestamps.push(now);
        this.inFlight++;
        return;
      }
      const waitMs =
        this.inFlight >= this.maxParallel
          ? 50
          : Math.max(10, this.windowMs - (now - this.timestamps[0]));
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }

  release(): void {
    this.inFlight--;
    const next = this.queue.shift();
    if (next) next();
  }
}

export interface HttpClientOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  limiter?: RateLimiter;
  /** Логгер запросов; по умолчанию тишина. */
  log?: (line: string) => void;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpClient {
  private readonly limiter: RateLimiter;
  private readonly baseUrl: string;
  private readonly opts: HttpClientOptions;

  constructor(baseUrl: string, opts: HttpClientOptions = {}) {
    this.baseUrl = baseUrl;
    this.opts = opts;
    this.limiter = opts.limiter ?? new RateLimiter();
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = path.startsWith("http") ? path : this.baseUrl + path;
    const retries = this.opts.retries ?? 4;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(16000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, backoff));
      }
      await this.limiter.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30000);
      try {
        this.opts.log?.(`${method} ${url}${attempt ? ` (попытка ${attempt + 1})` : ""}`);
        const res = await fetch(url, {
          method,
          headers: {
            Accept: "application/json;charset=utf-8",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...this.opts.headers,
            ...extraHeaders,
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        const text = await res.text();
        if (!res.ok) {
          if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
            lastError = new HttpError(res.status, url, text, method);
            continue;
          }
          throw new HttpError(res.status, url, text, method);
        }
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as unknown as T;
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        lastError = err;
        if (attempt === retries) break;
      } finally {
        clearTimeout(timer);
        this.limiter.release();
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  get<T = unknown>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", path, undefined, headers);
  }
  post<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>("POST", path, body, headers);
  }
  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }
  delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}
