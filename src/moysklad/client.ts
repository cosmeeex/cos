/**
 * Клиент JSON API 1.2 МойСклад — подмножество, нужное интеграции маркировки.
 * Документация: https://dev.moysklad.ru/doc/api/remap/1.2/
 */
import { HttpClient, RateLimiter } from "../core/http.ts";
import type { AppConfig } from "../core/config.ts";

/**
 * Признак предмета маркировки у товара (поле product.trackingType).
 * Для Cosmex главные: PERFUMERY (духи), CHEMISTRY (косметика и бытовая химия),
 * SANITIZER (антисептики), NOT_TRACKED.
 */
export type TrackingType =
  | "NOT_TRACKED"
  | "PERFUMERY"
  | "CHEMISTRY" // косметика и бытовая химия (ПП № 1681)
  | "SANITIZER"
  | "ELECTRONICS"
  | "FOOD_SUPPLEMENT"
  | "LP_CLOTHES"
  | "LP_LINENS"
  | "MILK"
  | "NCP"
  | "OTP"
  | "SHOES"
  | "TIRES"
  | "TOBACCO"
  | "WATER"
  | "MEDICAL_DEVICES"
  | string; // МойСклад добавляет новые значения — не ломаемся на неизвестных

export interface Meta {
  href: string;
  type: string;
  mediaType?: string;
  size?: number;
  limit?: number;
  offset?: number;
  nextHref?: string;
}

export interface Entity {
  meta: Meta;
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface Barcode {
  ean13?: string;
  ean8?: string;
  code128?: string;
  gtin?: string;
  upc?: string;
}

export interface Product extends Entity {
  code?: string;
  article?: string;
  archived?: boolean;
  pathName?: string;
  barcodes?: Barcode[];
  trackingType?: TrackingType;
  tnved?: string;
  country?: { meta: Meta };
  productFolder?: { meta: Meta };
  attributes?: Array<{ id: string; name: string; value: unknown }>;
}

export interface TrackingCode {
  cis: string;
  type: "trackingcode" | "consumerpack" | "transportpack";
  trackingCodes?: TrackingCode[]; // вложенность для агрегатов
}

export interface DocumentPosition {
  meta?: Meta;
  quantity: number;
  assortment: Entity;
  trackingCodes?: TrackingCode[];
  [key: string]: unknown;
}

export interface MsDocument extends Entity {
  moment?: string;
  applicable?: boolean;
  sum?: number;
  positions?: { meta: Meta; rows?: DocumentPosition[] };
  agent?: { meta: Meta };
  store?: { meta: Meta };
}

export interface ListResponse<T> {
  meta: Meta;
  rows: T[];
}

export interface StockRow {
  meta?: Meta;
  name?: string;
  code?: string;
  article?: string;
  stock: number;
  reserve?: number;
  inTransit?: number;
  quantity?: number;
  [key: string]: unknown;
}

export interface Webhook extends Entity {
  url?: string;
  action?: "CREATE" | "UPDATE" | "DELETE" | "PROCESSED";
  entityType?: string;
  enabled?: boolean;
}

export type DocumentType =
  | "demand"
  | "retaildemand"
  | "supply"
  | "enter"
  | "loss"
  | "salesreturn"
  | "retailsalesreturn"
  | "customerorder"
  | "emissionorder" // Заказ кодов маркировки
  | "retireorder"; // Вывод из оборота

/** Документы, у позиций которых JSON API 1.2 поддерживает trackingCodes. */
export const DOCS_WITH_TRACKING_CODES: ReadonlySet<string> = new Set([
  "demand",
  "retaildemand",
  "supply",
  "retireorder",
]);

/** Способ ввода в оборот для Заказа КМ (emissionorder.emissionType). */
export type EmissionType = "LOCAL" | "FOREIGN" | "REMAINS" | "COMMISSION" | "REAPPLY";

/** Причина вывода из оборота (retireorder.retireOrderType) — основные для Cosmex. */
export type RetireOrderType =
  | "RETAIL_SALE"
  | "DISTANCE" // дистанционная продажа (интернет-магазин)
  | "DAMAGE_AND_LOSS"
  | "EXPIRATION"
  | "OWN_USE"
  | "DESTRUCTION"
  | "OTHER_TYPE"
  | string;

export class MoyskladClient {
  readonly http: HttpClient;

  constructor(cfg: AppConfig["moysklad"], log?: (line: string) => void) {
    const headers: Record<string, string> = {
      "Accept-Encoding": "gzip",
    };
    if (cfg.token) {
      headers["Authorization"] = `Bearer ${cfg.token}`;
    } else if (cfg.login && cfg.password) {
      headers["Authorization"] =
        "Basic " + Buffer.from(`${cfg.login}:${cfg.password}`).toString("base64");
    } else {
      throw new Error("МойСклад: нет ни токена, ни логина/пароля (см. .env.example)");
    }
    this.http = new HttpClient(cfg.baseUrl, {
      headers,
      limiter: new RateLimiter(40, 3000, 4),
      log,
    });
  }

  // ---------- Товары и ассортимент ----------

  /** Постраничный обход любой коллекции; отдаёт строки по мере загрузки. */
  async *iterate<T extends Entity>(path: string, params = "", pageSize = 1000): AsyncGenerator<T> {
    let offset = 0;
    for (;;) {
      const sep = params ? `&${params}` : "";
      const page = await this.http.get<ListResponse<T>>(
        `${path}?limit=${pageSize}&offset=${offset}${sep}`,
      );
      for (const row of page.rows) yield row;
      offset += page.rows.length;
      if (page.rows.length < pageSize || offset >= (page.meta.size ?? 0)) return;
    }
  }

  async allProducts(): Promise<Product[]> {
    const out: Product[] = [];
    for await (const p of this.iterate<Product>("/entity/product")) out.push(p);
    return out;
  }

  async productById(id: string): Promise<Product> {
    return this.http.get<Product>(`/entity/product/${id}`);
  }

  /** Обновляет признак маркировки и/или ТН ВЭД у товара. */
  async updateProduct(id: string, patch: Partial<Product>): Promise<Product> {
    return this.http.put<Product>(`/entity/product/${id}`, patch);
  }

  /** Массовое обновление товаров (до 1000 за запрос, у каждого должна быть meta). */
  async bulkUpdateProducts(rows: Array<Partial<Product> & { meta: Meta }>): Promise<Product[]> {
    return this.http.post<Product[]>("/entity/product", rows);
  }

  // ---------- Документы ----------

  async document(type: DocumentType, id: string, expandPositions = true): Promise<MsDocument> {
    const expand = expandPositions ? "?expand=positions.assortment&limit=100" : "";
    return this.http.get<MsDocument>(`/entity/${type}/${id}${expand}`);
  }

  async documentPositions(type: DocumentType, id: string): Promise<DocumentPosition[]> {
    const out: DocumentPosition[] = [];
    for await (const row of this.iterate<Entity>(
      `/entity/${type}/${id}/positions`,
      "expand=assortment",
      100,
    )) {
      out.push(row as unknown as DocumentPosition);
    }
    return out;
  }

  /** Читает коды маркировки позиции (субресурс trackingCodes, страницы по 100). */
  async positionTrackingCodes(
    type: DocumentType,
    docId: string,
    positionId: string,
  ): Promise<TrackingCode[]> {
    if (!DOCS_WITH_TRACKING_CODES.has(type)) return [];
    const out: TrackingCode[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.http.get<ListResponse<TrackingCode & Entity>>(
        `/entity/${type}/${docId}/positions/${positionId}/trackingCodes?limit=100&offset=${offset}`,
      );
      out.push(...page.rows);
      offset += page.rows.length;
      if (page.rows.length < 100 || offset >= (page.meta.size ?? 0)) return out;
    }
  }

  /** Записывает коды маркировки в позицию документа (массовое создание/обновление). */
  async setPositionTrackingCodes(
    type: DocumentType,
    docId: string,
    positionId: string,
    codes: TrackingCode[],
  ): Promise<unknown> {
    if (!DOCS_WITH_TRACKING_CODES.has(type)) {
      throw new Error(`Документ ${type} не поддерживает trackingCodes в JSON API 1.2`);
    }
    return this.http.post(
      `/entity/${type}/${docId}/positions/${positionId}/trackingCodes`,
      codes,
    );
  }

  // ---------- Документы маркировки ----------

  /**
   * Создаёт Заказ кодов маркировки. Отправка в СУЗ и получение кодов —
   * кнопки в интерфейсе МойСклад (documentState доступен только на чтение),
   * поэтому конвейер остатков готовит документ, а менеджер жмёт «Заказ кодов».
   */
  async createEmissionOrder(opts: {
    organizationMeta: Meta;
    trackingType: TrackingType;
    emissionType: EmissionType;
    name?: string;
    description?: string;
    positions: Array<{ assortmentMeta: Meta; quantity: number }>;
  }): Promise<MsDocument> {
    return this.http.post<MsDocument>("/entity/emissionorder", {
      name: opts.name,
      description: opts.description,
      organization: { meta: opts.organizationMeta },
      trackingType: opts.trackingType,
      emissionType: opts.emissionType,
      positions: opts.positions.map((p) => ({
        assortment: { meta: p.assortmentMeta },
        quantity: p.quantity,
      })),
    });
  }

  /**
   * Создаёт Вывод из оборота (например, DISTANCE для интернет-заказов
   * до 01.07.2026 либо для сценариев вне кассы: порча, истёкший срок).
   */
  async createRetireOrder(opts: {
    organizationMeta: Meta;
    trackingType: TrackingType;
    retireOrderType: RetireOrderType;
    name?: string;
    description?: string;
    positions: Array<{
      assortmentMeta: Meta;
      quantity: number;
      price?: number;
      trackingCodes: TrackingCode[];
    }>;
  }): Promise<MsDocument> {
    return this.http.post<MsDocument>("/entity/retireorder", {
      name: opts.name,
      description: opts.description,
      organization: { meta: opts.organizationMeta },
      trackingType: opts.trackingType,
      retireOrderType: opts.retireOrderType,
      positions: opts.positions.map((p) => ({
        assortment: { meta: p.assortmentMeta },
        quantity: p.quantity,
        price: p.price,
        trackingCodes: p.trackingCodes,
      })),
    });
  }

  async organizations(): Promise<Entity[]> {
    const res = await this.http.get<ListResponse<Entity>>("/entity/organization");
    return res.rows;
  }

  // ---------- Отчёты ----------

  async stockAll(params = ""): Promise<StockRow[]> {
    const out: StockRow[] = [];
    let href: string | null = `/report/stock/all?limit=1000${params ? `&${params}` : ""}`;
    while (href) {
      const page: ListResponse<StockRow> = await this.http.get<ListResponse<StockRow>>(href);
      out.push(...page.rows);
      href = page.meta.nextHref ?? null;
    }
    return out;
  }

  // ---------- Вебхуки ----------

  async webhooks(): Promise<Webhook[]> {
    const res = await this.http.get<ListResponse<Webhook>>("/entity/webhook");
    return res.rows;
  }

  async createWebhook(url: string, entityType: string, action: Webhook["action"]): Promise<Webhook> {
    return this.http.post<Webhook>("/entity/webhook", { url, entityType, action });
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.http.delete(`/entity/webhook/${id}`);
  }

  /**
   * Идемпотентно приводит набор вебхуков к желаемому списку.
   * prefix — базовый адрес вида https://host/webhook[/секрет];
   * свои же вебхуки на том же хосте с другим форматом URL удаляются.
   */
  async ensureWebhooks(
    prefix: string,
    wanted: Array<{ entityType: string; action: Webhook["action"] }>,
  ): Promise<{ created: number; kept: number; removed: number }> {
    const host = new URL(prefix).host;
    const existing = await this.webhooks();
    const wantedUrls = new Map(
      wanted.map((w) => [
        `${w.entityType}:${w.action}`,
        `${prefix}/${w.entityType}/${(w.action ?? "").toLowerCase()}`,
      ]),
    );
    let created = 0;
    let kept = 0;
    let removed = 0;
    // Убираем свои устаревшие/битые вебхуки на этом хосте.
    for (const e of existing) {
      if (!e.url || !e.url.includes(host)) continue;
      const desired = wantedUrls.get(`${e.entityType}:${e.action}`);
      if (e.url === desired) continue;
      if (e.id) {
        await this.deleteWebhook(e.id);
        removed++;
      }
    }
    const fresh = await this.webhooks();
    for (const [key, url] of wantedUrls) {
      const [entityType, action] = key.split(":") as [string, Webhook["action"]];
      const found = fresh.find(
        (e) => e.entityType === entityType && e.action === action && e.url === url,
      );
      if (found) {
        kept++;
      } else {
        await this.createWebhook(url, entityType, action);
        created++;
      }
    }
    return { created, kept, removed };
  }
}

/** Достаёт id сущности из href метаданных МойСклад. */
export function idFromHref(href: string): string {
  const clean = href.split("?")[0];
  return clean.slice(clean.lastIndexOf("/") + 1);
}
