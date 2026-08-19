/**
 * Аудит ассортимента: какие товары подлежат маркировке и что не так с карточками.
 *
 * Проверяет каждую карточку МойСклад:
 *   — подлежит ли товар маркировке (классификатор + волны);
 *   — совпадает ли trackingType в карточке с ожидаемым;
 *   — заполнены ли ТН ВЭД и GTIN (для заказа КМ GTIN обязателен);
 *   — особые случаи (наборы, мисты, тестеры) — на ручной разбор.
 *
 * Результат — машиночитаемый JSON + человекочитаемый Markdown-отчёт.
 */
import { classify, obligationOn, type ClassifiedItem } from "./rules.ts";
import { isValidGtin, toGtin14 } from "../core/gs1.ts";

export interface AuditableProduct {
  id: string;
  name: string;
  pathName?: string | null;
  tnved?: string | null;
  trackingType?: string | null;
  archived?: boolean;
  barcodes?: Array<Record<string, string | undefined>>;
}

export type AuditIssueCode =
  | "TRACKING_TYPE_MISSING" // должен быть маркируемым, в карточке NOT_TRACKED
  | "TRACKING_TYPE_WRONG" // признак есть, но не тот
  | "TRACKING_TYPE_EXCESS" // признак стоит, но товар не похож на маркируемый
  | "TNVED_MISSING" // не заполнен ТН ВЭД
  | "GTIN_MISSING" // нет GTIN/EAN — нельзя заказать КМ и описать в НК
  | "GTIN_INVALID" // штрихкод не проходит контрольную цифру
  | "SPECIAL_CASE" // набор/мист/тестер — ручное решение
  | "UNCLASSIFIED"; // не удалось классифицировать

export interface AuditRow {
  product: AuditableProduct;
  classified: ClassifiedItem;
  issues: Array<{ code: AuditIssueCode; message: string }>;
}

export interface AuditReport {
  generatedAt: string;
  total: number;
  tracked: number;
  clean: number;
  rows: AuditRow[]; // только строки с проблемами или особыми случаями
  byIssue: Record<string, number>;
}

export function extractGtins(product: AuditableProduct): string[] {
  const out: string[] = [];
  for (const bc of product.barcodes ?? []) {
    for (const key of ["gtin", "ean13", "ean8", "upc"]) {
      const value = bc[key];
      if (value) {
        const g = toGtin14(value);
        if (g) out.push(g);
      }
    }
  }
  return [...new Set(out)];
}

export function auditProduct(product: AuditableProduct, now = new Date()): AuditRow {
  const classified = classify(product);
  const issues: AuditRow["issues"] = [];
  const tracked =
    classified.wave !== null && obligationOn(classified.wave, now).markingMandatory;
  const cardTracking = product.trackingType ?? "NOT_TRACKED";

  if (tracked) {
    if (cardTracking === "NOT_TRACKED") {
      issues.push({
        code: "TRACKING_TYPE_MISSING",
        message: `подлежит маркировке (${classified.wave!.title}), но в карточке «Без маркировки» — касса не запросит код. Установить: ${classified.wave!.trackingType}`,
      });
    } else if (cardTracking !== classified.wave!.trackingType) {
      issues.push({
        code: "TRACKING_TYPE_WRONG",
        message: `в карточке ${cardTracking}, ожидается ${classified.wave!.trackingType} (${classified.wave!.title})`,
      });
    }
    if (!product.tnved) {
      issues.push({
        code: "TNVED_MISSING",
        message: `не заполнен ТН ВЭД — нужен для УПД и заказа КМ (ожидается из: ${classified.wave!.tnved.join(", ")})`,
      });
    }
    const gtins = extractGtins(product);
    if (gtins.length === 0) {
      issues.push({
        code: "GTIN_MISSING",
        message: "нет GTIN/EAN-13 — без него нельзя заказать коды и описать товар в Национальном каталоге",
      });
    } else {
      for (const g of gtins) {
        if (!isValidGtin(g)) {
          issues.push({ code: "GTIN_INVALID", message: `штрихкод ${g} не проходит контрольную цифру` });
        }
      }
    }
  } else if (cardTracking !== "NOT_TRACKED" && classified.group === "none" && classified.confidence >= 0.8) {
    issues.push({
      code: "TRACKING_TYPE_EXCESS",
      message: `в карточке признак ${cardTracking}, но товар классифицирован как немаркируемый (${classified.reasons.join("; ")}) — касса будет требовать код там, где его нет`,
    });
  }

  // «professional» (салонный объём) — просто пометка, правила маркировки те же.
  if (
    classified.special &&
    classified.special !== "professional" &&
    (tracked || classified.special === "perfumed-mist")
  ) {
    issues.push({
      code: "SPECIAL_CASE",
      message: `особый случай «${classified.special}»: ${classified.reasons.join("; ")}`,
    });
  }
  if (classified.confidence <= 0.3) {
    issues.push({ code: "UNCLASSIFIED", message: "не классифицирован — проверить вручную и заполнить ТН ВЭД" });
  }

  return { product, classified, issues };
}

export function auditAll(products: AuditableProduct[], now = new Date()): AuditReport {
  const rows: AuditRow[] = [];
  let tracked = 0;
  const byIssue: Record<string, number> = {};

  for (const p of products) {
    if (p.archived) continue;
    const row = auditProduct(p, now);
    if (row.classified.wave && obligationOn(row.classified.wave, now).markingMandatory) tracked++;
    if (row.issues.length > 0) {
      rows.push(row);
      for (const i of row.issues) byIssue[i.code] = (byIssue[i.code] ?? 0) + 1;
    }
  }

  const active = products.filter((p) => !p.archived).length;
  return {
    generatedAt: now.toISOString(),
    total: active,
    tracked,
    clean: active - rows.length,
    rows,
    byIssue,
  };
}

const ISSUE_TITLES: Record<AuditIssueCode, string> = {
  TRACKING_TYPE_MISSING: "Нет признака маркировки (критично: касса не запросит код)",
  TRACKING_TYPE_WRONG: "Неверный признак маркировки",
  TRACKING_TYPE_EXCESS: "Лишний признак маркировки (касса требует код у немаркируемого)",
  TNVED_MISSING: "Не заполнен ТН ВЭД",
  GTIN_MISSING: "Нет GTIN/EAN-13 (нельзя заказать коды)",
  GTIN_INVALID: "Битый штрихкод",
  SPECIAL_CASE: "Особые случаи (наборы, мисты, тестеры) — ручной разбор",
  UNCLASSIFIED: "Не классифицированы — ручная проверка",
};

/** Markdown-отчёт для владельца/менеджеров. */
export function renderAuditMarkdown(report: AuditReport): string {
  const lines: string[] = [
    `# Аудит ассортимента по маркировке`,
    ``,
    `Сформирован: ${report.generatedAt}`,
    ``,
    `- Активных карточек: **${report.total}**`,
    `- Подлежат маркировке уже сейчас: **${report.tracked}**`,
    `- Карточек без замечаний: **${report.clean}**`,
    `- Карточек с проблемами: **${report.rows.length}**`,
    ``,
    `## Сводка по типам проблем`,
    ``,
  ];
  for (const [code, count] of Object.entries(report.byIssue).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${ISSUE_TITLES[code as AuditIssueCode] ?? code}: **${count}**`);
  }
  lines.push(``, `## Детали`, ``);
  for (const code of Object.keys(ISSUE_TITLES) as AuditIssueCode[]) {
    const rows = report.rows.filter((r) => r.issues.some((i) => i.code === code));
    if (rows.length === 0) continue;
    lines.push(`### ${ISSUE_TITLES[code]} — ${rows.length}`, ``);
    for (const r of rows.slice(0, 200)) {
      const msg = r.issues.filter((i) => i.code === code).map((i) => i.message).join("; ");
      lines.push(`- **${r.product.name}**${r.product.pathName ? ` _(${r.product.pathName})_` : ""}: ${msg}`);
    }
    if (rows.length > 200) lines.push(`- … и ещё ${rows.length - 200}`);
    lines.push(``);
  }
  return lines.join("\n");
}
