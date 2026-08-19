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
  private readonly omsToken: string;

  constructor(http: HttpClient, signer: Signer, omsId: string, omsToken: string) {
    this.http = http;
    this.signer = signer;
    this.omsId = omsId;
    this.omsToken = omsToken;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { clientToken: this.omsToken, ...extra };
  }

  /** Создаёт заказ на эмиссию КМ. Возвращает orderId. */
  async createOrder(req: CreateOrderRequest, productGroup: string): Promise<string> {
    const body = JSON.stringify(req);
    const signature = await this.signer.sign(body);
    const res = await this.http.request<{ orderId: string }>(
      "POST",
      `/order?omsId=${this.omsId}`,
      req,
      this.headers({
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
      this.headers({ productGroup }),
    );
    const info = res.orderInfos?.find((o) => o.orderId === orderId) ?? res.orderInfos?.[0];
    return info?.buffers ?? [];
  }

  /** Забирает готовые коды по GTIN (порциями). Каждый код — строка с GS-разделителями. */
  async getCodes(orderId: string, gtin: string, quantity: number, productGroup: string): Promise<string[]> {
    const res = await this.http.get<{ codes: string[] }>(
      `/codes?omsId=${this.omsId}&orderId=${orderId}&gtin=${gtin}&quantity=${quantity}`,
      this.headers({ productGroup }),
    );
    return res.codes ?? [];
  }

  /** Пинг СУЗ — проверка связи и токена. */
  async ping(productGroup: string): Promise<boolean> {
    try {
      await this.http.get(`/ping?omsId=${this.omsId}`, this.headers({ productGroup }));
      return true;
    } catch {
      return false;
    }
  }
}
