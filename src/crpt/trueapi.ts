/**
 * Клиент True API ГИС МТ «Честный знак».
 *
 * Авторизация — «вызов-ответ»:
 *   1. GET /auth/key → { uuid, data }
 *   2. data подписывается УКЭП (присоединённая CMS, base64) внешним подписантом
 *   3. POST /auth/simpleSignIn { uuid, data: <подпись> } → { token } (жизнь ~10 часов)
 *
 * Все ответы и коды могут отличаться между продуктивом и песочницей —
 * адреса задаются конфигом (см. core/config.ts).
 */
import { HttpClient } from "../core/http.ts";
import type { Signer } from "./signer.ts";
import { toBase64Cis } from "../core/gs1.ts";

export interface CisInfo {
  /** Код идентификации. */
  cis: string;
  gtin?: string;
  /** Статус экземпляра: EMITTED, APPLIED, INTRODUCED, RETIRED, WITHDRAWN, DISAGGREGATED и др. */
  status?: string;
  /** ИНН текущего владельца. */
  ownerInn?: string;
  ownerName?: string;
  producerInn?: string;
  emissionDate?: string;
  introducedDate?: string;
  productName?: string;
  [key: string]: unknown;
}

export interface CodeCheckResult {
  code: string;
  valid?: boolean;
  verified?: boolean;
  realizable?: boolean;
  utilised?: boolean;
  isBlocked?: boolean;
  expireDate?: string;
  isOwner?: boolean;
  sold?: boolean;
  found?: boolean;
  errorCode?: number;
  message?: string;
  [key: string]: unknown;
}

export class TrueApiClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  private readonly http: HttpClient;
  private readonly signer: Signer;
  private readonly log?: (line: string) => void;

  constructor(http: HttpClient, signer: Signer, log?: (line: string) => void) {
    this.http = http;
    this.signer = signer;
    this.log = log;
  }

  /** Получает (и кэширует) токен авторизации. */
  async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const challenge = await this.http.get<{ uuid: string; data: string }>("/auth/key");
    const signature = await this.signer.sign(challenge.data);
    const res = await this.http.post<{ token: string }>("/auth/simpleSignIn", {
      uuid: challenge.uuid,
      data: signature,
    });
    this.token = res.token;
    // Токен True API живёт 10 часов; обновляем заранее.
    this.tokenExpiresAt = Date.now() + 9.5 * 3600 * 1000;
    this.log?.("True API: получен новый токен");
    return this.token;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.ensureToken()}` };
  }

  /**
   * Информация об экземплярах по списку кодов (полные КМ или коды идентификации).
   * До 1000 кодов за вызов; вход — «сырые» строки, кодирование внутри.
   */
  async cisesInfo(rawCodes: string[]): Promise<CisInfo[]> {
    const headers = await this.authHeaders();
    const out: CisInfo[] = [];
    for (let i = 0; i < rawCodes.length; i += 1000) {
      const chunk = rawCodes.slice(i, i + 1000);
      const res = await this.http.post<Array<{ cisInfo: CisInfo }>>(
        "/cises/info",
        chunk,
        headers,
      );
      out.push(...res.map((r) => r.cisInfo ?? (r as unknown as CisInfo)));
    }
    return out;
  }

  /**
   * Онлайн-проверка кодов (метод разрешительного режима, /codes/check).
   * Вход — сырые сканы; кодируются в base64 по требованию API.
   */
  async codesCheck(rawCodes: string[], fiscalDriveNumber?: string): Promise<CodeCheckResult[]> {
    const headers = await this.authHeaders();
    const body: Record<string, unknown> = {
      codes: rawCodes.map((c) => toBase64Cis(c)),
    };
    if (fiscalDriveNumber) body.fiscalDriveNumber = fiscalDriveNumber;
    const res = await this.http.post<{ codes: CodeCheckResult[] }>("/codes/check", body, headers);
    return res.codes ?? [];
  }

  /** Список КМ в обороте у участника (для сверки остатков). Параметры — фильтр ГИС МТ. */
  async cisList(params: Record<string, string>): Promise<CisInfo[]> {
    const headers = await this.authHeaders();
    const qs = new URLSearchParams(params).toString();
    const res = await this.http.get<{ results?: CisInfo[]; rows?: CisInfo[] }>(
      `/cises/search?${qs}`,
      headers,
    );
    return res.results ?? res.rows ?? [];
  }

  /** Создание документа (ввод в оборот, вывод, перемаркировка) — универсальная обёртка. */
  async createDocument(opts: {
    productGroup: string; // например "perfumery" | "beauty"
    documentFormat: "MANUAL" | "XML" | "CSV";
    type: string; // LP_INTRODUCE_GOODS, LK_RECEIPT, LP_RETURN и др.
    document: unknown; // тело документа (объект — будет сериализован и закодирован)
  }): Promise<{ id?: string; value?: string }> {
    const headers = await this.authHeaders();
    const json = JSON.stringify(opts.document);
    const productDocument = Buffer.from(json, "utf8").toString("base64");
    const signature = await this.signer.sign(json);
    return this.http.post(
      `/lk/documents/create?pg=${encodeURIComponent(opts.productGroup)}`,
      {
        document_format: opts.documentFormat,
        product_document: productDocument,
        signature,
        type: opts.type,
      },
      headers,
    );
  }

  /** Статус обработки документа в ГИС МТ. */
  async documentInfo(docId: string, productGroup: string): Promise<Record<string, unknown>> {
    const headers = await this.authHeaders();
    const res = await this.http.get<Record<string, unknown>[]>(
      `/doc/list?pg=${encodeURIComponent(productGroup)}&did=${encodeURIComponent(docId)}`,
      headers,
    );
    return Array.isArray(res) ? (res[0] ?? {}) : (res as Record<string, unknown>);
  }
}
