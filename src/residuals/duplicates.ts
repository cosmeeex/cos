/**
 * Карточки-дубли «(немарк.)» для продажи законных немаркированных остатков.
 *
 * Официальная рекомендация поддержки МойСклад (26.08.2026): немаркированный
 * остаток продаётся через отдельную карточку без признака маркировки.
 * Модуль автоматизирует жизненный цикл дубля:
 *   создать дубль → перенести остаток (списание с основной + оприходование
 *   на дубль) → следить → закрыть (обратный перенос неликвида/архив).
 *
 * У дубля НЕТ штрихкодов (иначе скан EAN на кассе находил бы две карточки)
 * и НЕТ признака маркировки. Кассир находит дубль по названию.
 */

export const DUP_SUFFIX = " (немарк.)";
export const DUP_MARKER = "[немарк-дубль]";

export function dupName(name: string): string {
  return name.endsWith(DUP_SUFFIX) ? name : `${name}${DUP_SUFFIX}`;
}

export function isDupName(name: string): boolean {
  return name.endsWith(DUP_SUFFIX);
}

export interface DupRequest {
  /** Точное название основной карточки в МойСклад. */
  name: string;
  /** Сколько единиц перенести на дубль (немаркированный остаток). */
  quantity: number;
}

export interface ProductLite {
  id: string;
  name: string;
  archived?: boolean;
  trackingType?: string | null;
  stock?: number;
}

export type DupActionKind =
  | "create_dup" // создать карточку-дубль
  | "reuse_dup" // дубль уже есть
  | "transfer" // перенести остаток (loss с основной + enter на дубль)
  | "reject";

export interface DupAction {
  kind: DupActionKind;
  sourceName: string;
  dupNameResolved: string;
  quantity: number;
  reason?: string;
}

/** Разбор CSV «название;количество» (строки с # игнорируются). */
export function parseDupCsv(text: string): DupRequest[] {
  const out: DupRequest[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.lastIndexOf(";");
    if (sep === -1) continue;
    const name = trimmed.slice(0, sep).trim();
    const quantity = Number(trimmed.slice(sep + 1).trim().replace(",", "."));
    if (name && Number.isFinite(quantity) && quantity > 0) {
      out.push({ name, quantity: Math.floor(quantity) });
    }
  }
  return out;
}

/**
 * Строит план действий по списку заявок. Чистая логика: продукты и остатки
 * приходят снаружи, решения объяснимы и тестируемы.
 */
export function planDuplicates(requests: DupRequest[], products: ProductLite[]): DupAction[] {
  const byName = new Map(products.filter((p) => !p.archived).map((p) => [p.name, p]));
  const actions: DupAction[] = [];

  for (const req of requests) {
    const source = byName.get(req.name);
    const target = dupName(req.name);

    if (isDupName(req.name)) {
      actions.push({ kind: "reject", sourceName: req.name, dupNameResolved: target, quantity: req.quantity, reason: "это уже карточка-дубль" });
      continue;
    }
    if (!source) {
      actions.push({ kind: "reject", sourceName: req.name, dupNameResolved: target, quantity: req.quantity, reason: "карточка не найдена (название должно совпадать точно)" });
      continue;
    }
    if (source.stock !== undefined && req.quantity > source.stock) {
      actions.push({
        kind: "reject",
        sourceName: req.name,
        dupNameResolved: target,
        quantity: req.quantity,
        reason: `на основной карточке остаток ${source.stock}, переносить ${req.quantity} нельзя`,
      });
      continue;
    }

    const existingDup = byName.get(target);
    actions.push({
      kind: existingDup ? "reuse_dup" : "create_dup",
      sourceName: req.name,
      dupNameResolved: target,
      quantity: req.quantity,
    });
    actions.push({ kind: "transfer", sourceName: req.name, dupNameResolved: target, quantity: req.quantity });
  }
  return actions;
}

/** Дубли, которые пора закрывать/проверять: пустые (архив) и долгожители. */
export function dupHealth(
  dups: Array<{ name: string; stock: number; createdAt?: string }>,
  now = new Date(),
  maxAgeDays = 60,
): Array<{ name: string; stock: number; verdict: "archive" | "stale" | "ok"; note: string }> {
  return dups.map((d) => {
    if (d.stock <= 0) {
      return { name: d.name, stock: d.stock, verdict: "archive" as const, note: "остаток распродан — карточку можно архивировать" };
    }
    const ageDays = d.createdAt
      ? Math.floor((now.getTime() - new Date(d.createdAt).getTime()) / 86400_000)
      : null;
    if (ageDays !== null && ageDays > maxAgeDays) {
      return {
        name: d.name,
        stock: d.stock,
        verdict: "stale" as const,
        note: `дубль живёт ${ageDays} дн. с остатком ${d.stock} — распродать со скидкой или домаркировать (см. SOP 30)`,
      };
    }
    return { name: d.name, stock: d.stock, verdict: "ok" as const, note: "" };
  });
}
