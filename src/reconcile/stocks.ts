/**
 * Сверка остатков МойСклад ↔ «Честный знак» по GTIN.
 *
 * Идея: количество кодов в статусе «В обороте» у нашего ИНН по каждому GTIN
 * должно совпадать с остатком товара в МойСклад. Расхождение = будущий штраф:
 *   — кодов больше, чем товара → «зависшие» коды (продали без вывода из оборота,
 *     потеряли товар, не приняли возврат правильно);
 *   — товара больше, чем кодов → продаём чужое/немаркированное (или коды
 *     не приняты по УПД).
 *
 * Модуль чистый: данные обеих систем приходят снаружи.
 */

export interface MsStockLine {
  gtin: string;
  name: string;
  stock: number;
}

export interface ChzStockLine {
  gtin: string;
  /** Количество КМ в статусе INTRODUCED (в обороте) у нашего ИНН. */
  inCirculation: number;
}

export type DiscrepancyKind =
  | "codes_exceed_stock" // кодов в ЧЗ больше, чем товара в МС
  | "stock_exceeds_codes" // товара больше, чем кодов
  | "only_in_chz" // GTIN есть в ЧЗ, товара в МС нет вовсе
  | "only_in_ms"; // маркируемый товар в МС без единого кода в ЧЗ

export interface Discrepancy {
  kind: DiscrepancyKind;
  gtin: string;
  name: string;
  msStock: number;
  chzCodes: number;
  delta: number;
  explanation: string;
  action: string;
}

export function reconcile(ms: MsStockLine[], chz: ChzStockLine[]): Discrepancy[] {
  const chzByGtin = new Map(chz.map((l) => [l.gtin, l.inCirculation]));
  const msByGtin = new Map<string, MsStockLine>();
  for (const line of ms) {
    const existing = msByGtin.get(line.gtin);
    if (existing) existing.stock += line.stock;
    else msByGtin.set(line.gtin, { ...line });
  }

  const out: Discrepancy[] = [];

  for (const [gtin, line] of msByGtin) {
    const codes = chzByGtin.get(gtin) ?? 0;
    chzByGtin.delete(gtin);
    if (codes === line.stock) continue;
    if (codes === 0) {
      out.push({
        kind: "only_in_ms",
        gtin,
        name: line.name,
        msStock: line.stock,
        chzCodes: 0,
        delta: line.stock,
        explanation:
          "в МойСклад есть остаток маркируемого товара, а в «Честном знаке» на нашем ИНН нет ни одного кода",
        action:
          "Проверить: (1) это остатки, выпущенные до волны маркировки (тогда законно, продаём до конца срока годности); (2) не подписан УПД поставщика (подписать!); (3) товар принят «мимо ЭДО» (недопустимо с 01.07.2026).",
      });
    } else if (codes > line.stock) {
      out.push({
        kind: "codes_exceed_stock",
        gtin,
        name: line.name,
        msStock: line.stock,
        chzCodes: codes,
        delta: codes - line.stock,
        explanation: "кодов «в обороте» больше, чем товара на складе — часть продаж не выведена из оборота",
        action:
          "Найти продажи/списания без вывода из оборота и оформить вывод (розничная продажа/дистанционная/порча). Это прямой риск штрафа по ст. 15.12.1 КоАП.",
      });
    } else {
      out.push({
        kind: "stock_exceeds_codes",
        gtin,
        name: line.name,
        msStock: line.stock,
        chzCodes: codes,
        delta: line.stock - codes,
        explanation: "товара больше, чем кодов у нас «в обороте»",
        action:
          "Проверить неподписанные УПД (коды ещё у поставщика) и дату выпуска партии (дорыночные остатки законны). Если товар выпуска после волны и кодов нет — не продавать, разбираться с поставщиком.",
      });
    }
    chzByGtin.delete(gtin);
  }

  for (const [gtin, codes] of chzByGtin) {
    if (codes <= 0) continue;
    out.push({
      kind: "only_in_chz",
      gtin,
      name: "(нет карточки/остатка в МойСклад)",
      msStock: 0,
      chzCodes: codes,
      delta: codes,
      explanation: "на нашем ИНН числятся коды «в обороте», а товара в МойСклад нет",
      action:
        "Инвентаризация: найти товар (возможно, продан без скана или списан без вывода из оборота). «Висящие» коды выводить с реальной причиной (продажа/порча/утрата), а не подгонять.",
    });
  }

  out.sort((a, b) => b.delta - a.delta);
  return out;
}

export function renderReconcileMarkdown(discrepancies: Discrepancy[], generatedAt: string): string {
  if (discrepancies.length === 0) {
    return `# Сверка остатков МойСклад ↔ Честный знак\n\n${generatedAt}: расхождений нет ✅`;
  }
  const lines = [
    `# Сверка остатков МойСклад ↔ Честный знак`,
    ``,
    `Сформирована: ${generatedAt}. Расхождений: **${discrepancies.length}**`,
    ``,
    `| GTIN | Товар | Остаток МС | Кодов в ЧЗ | Δ | Что это значит |`,
    `|---|---|---:|---:|---:|---|`,
  ];
  for (const d of discrepancies) {
    lines.push(
      `| ${d.gtin} | ${d.name} | ${d.msStock} | ${d.chzCodes} | ${d.delta} | ${d.explanation} |`,
    );
  }
  lines.push(``, `## Действия`, ``);
  for (const d of discrepancies.slice(0, 50)) {
    lines.push(`- **${d.name}** (${d.gtin}): ${d.action}`);
  }
  return lines.join("\n");
}
