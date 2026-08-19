/**
 * Конвейер маркировки товара без кодов («остатки» и собственный импорт).
 *
 * Когда это нужно:
 *   — REMAINS: добровольная маркировка остатков, выпущенных до волны
 *     (по ПП № 1681 их можно продавать и без кодов до конца срока годности,
 *     но промаркировав, снимаем споры о дате выпуска);
 *   — REMAINS: домаркировка гигиенической волны ПП № 656 (до 31.10.2027 обязательна
 *     для товара, выпущенного до 01.11.2026);
 *   — FOREIGN: собственный импорт СТМ COSMEX из Казахстана — маркирует импортёр;
 *   — REAPPLY: перемаркировка при повреждении этикетки.
 *
 * Ограничения МойСклад: в одном «Заказе КМ» ≤10 позиций и ≤1000 кодов на позицию;
 * крипточасть хранится ≤120 дней — заказывать нужно столько, сколько успеем
 * наклеить и ввести в оборот.
 */
import type { EmissionType } from "../moysklad/client.ts";

export interface ResidualItem {
  productId: string;
  name: string;
  gtin: string | null;
  /** Сколько единиц нужно промаркировать (обычно = остатку на складе). */
  quantity: number;
  trackingType: string;
  emissionType: EmissionType;
}

export interface EmissionBatch {
  /** Имя документа для МойСклад — менеджер найдёт его по этому имени. */
  name: string;
  trackingType: string;
  emissionType: EmissionType;
  positions: Array<{ productId: string; name: string; gtin: string; quantity: number }>;
  totalCodes: number;
  /** Ориентировочная стоимость кодов, руб. (50 коп. + НДС 22% = 0,61 ₽/код). */
  estimatedCostRub: number;
}

export interface ResidualPlan {
  batches: EmissionBatch[];
  /** Товары, которые нельзя включить (нет GTIN и т.п.) — сначала чинить карточки. */
  rejected: Array<{ item: ResidualItem; reason: string }>;
  totalCodes: number;
  estimatedCostRub: number;
}

export const CODE_PRICE_RUB = 0.61; // 50 коп. + НДС 22% (с 01.01.2026)
export const MAX_POSITIONS_PER_ORDER = 10;
export const MAX_QTY_PER_POSITION = 1000;

/**
 * Раскладывает потребность в кодах по документам «Заказ КМ».
 * Группирует по товарной группе и способу ввода — в одном заказе они едины.
 */
export function planResiduals(items: ResidualItem[], batchPrefix = "ОСТАТКИ"): ResidualPlan {
  const rejected: ResidualPlan["rejected"] = [];
  const valid: Array<ResidualItem & { gtin: string }> = [];

  for (const item of items) {
    if (!item.gtin) {
      rejected.push({ item, reason: "нет GTIN — сначала завести штрихкод и описать товар в Национальном каталоге" });
      continue;
    }
    if (item.quantity <= 0) {
      rejected.push({ item, reason: "нулевое количество" });
      continue;
    }
    valid.push({ ...item, gtin: item.gtin });
  }

  // Позиция ≤1000 кодов: режем большие количества на части.
  const positions: Array<{ item: ResidualItem & { gtin: string }; quantity: number }> = [];
  for (const item of valid) {
    let left = item.quantity;
    while (left > 0) {
      const take = Math.min(left, MAX_QTY_PER_POSITION);
      positions.push({ item, quantity: take });
      left -= take;
    }
  }

  // Группировка по (trackingType, emissionType), затем пачки по 10 позиций.
  const groups = new Map<string, typeof positions>();
  for (const pos of positions) {
    const key = `${pos.item.trackingType}::${pos.item.emissionType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(pos);
  }

  const batches: EmissionBatch[] = [];
  for (const [key, groupPositions] of groups) {
    const [trackingType, emissionType] = key.split("::") as [string, EmissionType];
    for (let i = 0; i < groupPositions.length; i += MAX_POSITIONS_PER_ORDER) {
      const chunk = groupPositions.slice(i, i + MAX_POSITIONS_PER_ORDER);
      const totalCodes = chunk.reduce((s, p) => s + p.quantity, 0);
      const n = batches.length + 1;
      batches.push({
        name: `${batchPrefix}-${String(n).padStart(3, "0")} ${emissionType} ${trackingType}`,
        trackingType,
        emissionType,
        positions: chunk.map((p) => ({
          productId: p.item.productId,
          name: p.item.name,
          gtin: p.item.gtin,
          quantity: p.quantity,
        })),
        totalCodes,
        estimatedCostRub: Math.round(totalCodes * CODE_PRICE_RUB * 100) / 100,
      });
    }
  }

  const totalCodes = batches.reduce((s, b) => s + b.totalCodes, 0);
  return {
    batches,
    rejected,
    totalCodes,
    estimatedCostRub: Math.round(totalCodes * CODE_PRICE_RUB * 100) / 100,
  };
}

export function renderResidualPlanMarkdown(plan: ResidualPlan, generatedAt: string): string {
  const lines = [
    `# План маркировки товара без кодов`,
    ``,
    `Сформирован: ${generatedAt}`,
    ``,
    `- Документов «Заказ КМ»: **${plan.batches.length}**`,
    `- Всего кодов: **${plan.totalCodes}** (~${plan.estimatedCostRub} ₽ по 0,61 ₽/код)`,
    `- Отклонено позиций: **${plan.rejected.length}**`,
    ``,
  ];
  if (plan.rejected.length) {
    lines.push(`## Сначала починить карточки`, ``);
    for (const r of plan.rejected) lines.push(`- **${r.item.name}**: ${r.reason}`);
    lines.push(``);
  }
  for (const b of plan.batches) {
    lines.push(
      `## ${b.name}`,
      ``,
      `Группа: ${b.trackingType}, способ ввода: ${b.emissionType}, кодов: ${b.totalCodes} (~${b.estimatedCostRub} ₽)`,
      ``,
      `| Товар | GTIN | Кол-во |`,
      `|---|---|---:|`,
    );
    for (const p of b.positions) lines.push(`| ${p.name} | ${p.gtin} | ${p.quantity} |`);
    lines.push(``);
  }
  lines.push(
    `## Дальнейшие шаги (менеджер, в МойСклад)`,
    ``,
    `1. Открыть Розница → Маркировка → Заказы кодов — документы уже созданы интеграцией.`,
    `2. В каждом документе нажать «Заказать коды», дождаться статуса «Коды получены».`,
    `3. Нажать «Печать» → наклеить этикетки на товар (сверяя название и GTIN!).`,
    `4. Создать «Ввод в оборот» из заказа КМ и провести его.`,
    `5. Уложиться в 120 дней с момента получения кодов — дальше крипточасть удаляется и печать невозможна.`,
  );
  return lines.join("\n");
}
