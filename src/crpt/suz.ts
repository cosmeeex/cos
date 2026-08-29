/**
 * Клиент СУЗ (станция управления заказами) — заказ кодов маркировки.
 *
 * Порядок работы:
 *   1. POST /order?omsId=… — заказ КМ (тело подписывается УКЭП);
 *   2. GET  /order/status — дождаться статуса READY у товарной позиции;
 *   3. GET  /codes?… — получить коды (списываются с баланса, ~60 коп. за код с НДС);
 *   4. Напечатать и нанести, затем подать «ввод в оборот» через True API.
 *
 * Коды, полученные из СУЗ, ЖИВУТ ОГРАНИЧЕННО в статусе «эмитирован»:
 * их надо нанести и ввести в оборот, иначе истекут (для остатков это главный риск).
 */
import { HttpClient } from "../core/http.ts";
import type { Signer } from "./signer.ts";

export interface OrderProductPosition {
  gtin: string;
  quantity: number;
  /** Способ выпуска в оборот: PRODUCTION | IMPORT | REMAINS | CROSSBORDER | REMARK */
  cisType?: "UNIT" | "GROUP" | "SET";
  serialNumberType?: "SELF_MADE" | "OPERATOR";
  templateId?: number;
}

export interface CreateOrderRequest {
  products: OrderProductPosition[];
  /** REMAINS — маркировка остатков; PRODUCTION; IMPORT; REMARK — перемаркировка. */
  releaseMethodType: "PRODUCTION" | "IMPORT" | "REMAINS" | "CROSSBORDER" | "REMARK";
  contactPerson?: string;
  createMethodType?: "SELF_MADE" | "CM" | "CL" | "CA";
  productionOrderId?: string;
}

export interface OrderStatusPosition {
  gtin: string;
  status: "PENDING" | "READY" | "REJECTED" | "CLOSED" | string;
  quantity?: number;
  leftInBuffer?: number;
  totalPassed?: number;
  rejectionReason?: string;
}

export class SuzClient {
  private readonly http: HttpClient;
  private readonly signer: Signer;
  private readonly omsId: string;
  /** Идентификатор соединения ОМС (из ЛК СУЗ). Идёт параметром, не токеном. */
  private readonly connectionId: string;
  /** Провайдер токена. СУЗ (ОМС) авторизуется ТОКЕНОМ True API (markirovka), а не
   *  собственным auth на suzgrid: свой suzgrid/auth/simpleSignIn даёт 4035
   *  «сервис-провайдер не найден» — этот путь для операторов, не для участника-ОМС. */
  private readonly getClientToken: () => Promise<string>;

  constructor(
    http: HttpClient,
    signer: Signer,
    omsId: string,
    connectionId: string,
    getClientToken: () => Promise<string>,
  ) {
    this.http = http;
    this.signer = signer;
    this.omsId = omsId;
    this.connectionId = connectionId;
    this.getClientToken = getClientToken;
  }

  /** Токен для заголовка clientToken — берём из True API (тот же, что для cises/info). */
  async ensureToken(): Promise<string> {
    return this.getClientToken();
  }

  private async headers(extra?: Record<string, string>): Promise<Record<string, string>> {
    return { clientToken: await this.ensureToken(), ...extra };
  }

  /** Создаёт заказ на эмиссию КМ. Возвращает orderId. */
  async createOrder(req: CreateOrderRequest, productGroup: string): Promise<string> {
    const body = JSON.stringify(req);
    const signature = await this.signer.sign(body);
    const res = await this.http.request<{ orderId: string }>(
      "POST",
      `/order?omsId=${this.omsId}`,
      req,
      await this.headers({
        "X-Signature": signature,
        productGroup,
      }),
    );
    return res.orderId;
  }

  /** Статусы товарных позиций заказа. */
  async orderStatus(orderId: string, productGroup: string): Promise<OrderStatusPosition[]> {
    const res = await this.http.get<{ orderInfos?: Array<{ orderId: string; buffers?: OrderStatusPosition[]; orderStatus?: string }> }>(
      `/order/status?omsId=${this.omsId}&orderId=${orderId}`,
      await this.headers({ productGroup }),
    );
    const info = res.orderInfos?.find((o) => o.orderId === orderId) ?? res.orderInfos?.[0];
    return info?.buffers ?? [];
  }

  /** Забирает готовые коды по GTIN (порциями). Каждый код — строка с GS-разделителями. */
  async getCodes(orderId: string, gtin: string, quantity: number, productGroup: string): Promise<string[]> {
    const res = await this.http.get<{ codes: string[] }>(
      `/codes?omsId=${this.omsId}&orderId=${orderId}&gtin=${gtin}&quantity=${quantity}`,
      await this.headers({ productGroup }),
    );
    return res.codes ?? [];
  }

  /** Детальный пинг: возвращает тело ответа СУЗ (для диагностики реквизитов/токена).
   *  omsIdOverride — чтобы проверить, не перепутаны ли omsId/connectionId. */
  async pingInfo(productGroup: string, omsIdOverride?: string): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(
      `/ping?omsId=${omsIdOverride ?? this.omsId}`,
      await this.headers({ productGroup }),
    );
  }
}
