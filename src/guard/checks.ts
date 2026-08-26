/**
 * Страж документов: правила, которые ловят ошибки маркировки ДО того,
 * как они превратятся в штраф. Чистая логика без сети — вся телеметрия
 * и данные приходят снаружи, поэтому правила полностью тестируемы.
 */
import { parseDataMatrix } from "../core/gs1.ts";
import { classify, obligationOn, type ClassifiedItem } from "../classifier/rules.ts";

export type Severity = "block" | "warn" | "info";

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
  /** Что делать менеджеру — простыми словами. */
  action: string;
  positionName?: string;
}

export interface PositionView {
  name: string;
  pathName?: string | null;
  tnved?: string | null;
  trackingType?: string | null;
  quantity: number;
  /** Сырые строки КМ, привязанные к позиции. */
  trackingCodes: string[];
  /** GTIN из штрихкодов карточки (если заполнен). */
  gtins?: string[];
}

export interface DocumentView {
  /** Тип документа МойСклад: demand, retaildemand, supply, salesreturn… */
  docType: string;
  name?: string;
  /** Дата операции. */
  moment?: Date;
  positions: PositionView[];
}

/**
 * Документы, при которых КМ покидает оборот или меняет владельца.
 * У «Списания» (loss) в JSON API нет trackingCodes — для него отдельное правило.
 */
const OUTBOUND_DOCS = new Set(["demand", "retaildemand", "retireorder"]);
const INBOUND_DOCS = new Set(["supply", "enter", "salesreturn", "retailsalesreturn"]);

export function isTracked(classified: ClassifiedItem, onDate: Date): boolean {
  return classified.wave !== null && obligationOn(classified.wave, onDate).markingMandatory;
}

/**
 * Главная проверка документа. Возвращает список находок;
 * наличие хотя бы одной с severity=block значит «документ проводить нельзя».
 */
export function checkDocument(doc: DocumentView, now = new Date()): Finding[] {
  const findings: Finding[] = [];
  const seenCodes = new Map<string, string>(); // identityCode -> имя позиции

  for (const pos of doc.positions) {
    const classified = classify(pos);
    const tracked =
      (pos.trackingType && pos.trackingType !== "NOT_TRACKED") || isTracked(classified, now);

    // 1. Маркируемый товар в расходном документе без кодов.
    if (tracked && OUTBOUND_DOCS.has(doc.docType)) {
      const codesCount = countConsumerCodes(pos.trackingCodes);
      // Переходный период (склад смешанный: 99% единиц — законные остатки
      // без кодов): нехватка кодов — предупреждение, а не блок. После
      // завершения домаркировки вернуть block.
      if (codesCount === 0) {
        findings.push({
          severity: "warn",
          code: "NO_CODES_ON_OUTBOUND",
          message: `«${pos.name}»: маркируемый товар уходит без кодов маркировки`,
          action:
            "Если это единицы С DataMatrix — отсканируйте каждую (обязательно!). Если это немаркированный остаток (выпуск до волны) — так можно, но лучше продавать его через карточку «(немарк.)».",
          positionName: pos.name,
        });
      } else if (codesCount < pos.quantity) {
        findings.push({
          severity: "warn",
          code: "CODES_LESS_THAN_QTY",
          message: `«${pos.name}»: кодов ${codesCount} при количестве ${pos.quantity}`,
          action: `Нормально, только если остальные ${pos.quantity - codesCount} шт. — немаркированные остатки. Если на них есть DataMatrix — отсканируйте.`,
          positionName: pos.name,
        });
      } else if (codesCount > pos.quantity) {
        findings.push({
          severity: "block",
          code: "CODES_MORE_THAN_QTY",
          message: `«${pos.name}»: кодов ${codesCount} больше, чем количество ${pos.quantity}`,
          action: "Удалите лишние коды — каждый код списывается из оборота и повторно не используется.",
          positionName: pos.name,
        });
      }
    }

    // 1а. Списание маркируемого товара: сам документ КМ не несёт —
    //     нужен парный «Вывод из оборота»/«Списание КМ», иначе коды повиснут.
    if (tracked && doc.docType === "loss") {
      findings.push({
        severity: "warn",
        code: "LOSS_NEEDS_RETIRE",
        message: `«${pos.name}»: списание маркируемого товара`,
        action:
          "После проведения списания оформите «Вывод из оборота» (порча/утрата или истёк срок годности) с кодами этих единиц — иначе коды останутся «в обороте» и всплывут при сверке.",
        positionName: pos.name,
      });
    }

    // 2. Приёмка маркируемого без кодов — предупреждение (мог быть ОСУ/УПД),
    //    но с 01.07.2026 приёмка косметики мимо ЭДО запрещена.
    if (tracked && INBOUND_DOCS.has(doc.docType) && countConsumerCodes(pos.trackingCodes) === 0) {
      findings.push({
        severity: doc.docType === "supply" ? "warn" : "info",
        code: "INBOUND_WITHOUT_CODES",
        message: `«${pos.name}»: приёмка маркируемого товара без кодов`,
        action:
          "Проверьте, что приёмка идёт по УПД через ЭДО и коды придут из документа поставщика. Приёмка косметики «мимо ЭДО» запрещена с 01.07.2026.",
        positionName: pos.name,
      });
    }

    // 3. Валидность каждого кода и защита от пересорта/дублей.
    for (const raw of pos.trackingCodes) {
      const parsed = parseDataMatrix(raw);
      for (const issue of parsed.issues) {
        findings.push({
          severity: "block",
          code: "BAD_CODE",
          message: `«${pos.name}»: код не прошёл проверку — ${issue}`,
          action: "Отсканируйте код заново с упаковки. Если код нечитаем — товар на карантинную полку, нужна перемаркировка.",
          positionName: pos.name,
        });
      }
      if (parsed.identityCode) {
        const prev = seenCodes.get(parsed.identityCode);
        if (prev) {
          findings.push({
            severity: "block",
            code: "DUPLICATE_CODE",
            message: `Один и тот же код отсканирован дважды: в «${prev}» и «${pos.name}»`,
            action: "Уберите дубль. Каждая единица товара имеет свой уникальный код — отсканируйте вторую единицу отдельно.",
            positionName: pos.name,
          });
        } else {
          seenCodes.set(parsed.identityCode, pos.name);
        }
        // Пересорт: GTIN кода должен совпадать со штрихкодом карточки.
        if (parsed.gtin && pos.gtins && pos.gtins.length > 0) {
          const norm = pos.gtins.map((g) => g.padStart(14, "0"));
          if (!norm.includes(parsed.gtin)) {
            findings.push({
              severity: "block",
              code: "GTIN_MISMATCH",
              message: `«${pos.name}»: код принадлежит другому товару (GTIN ${parsed.gtin} нет в штрихкодах карточки)`,
              action: "Это пересорт: отсканирован код с другого товара. Найдите правильную единицу или исправьте штрихкоды карточки.",
              positionName: pos.name,
            });
          }
        }
      }
    }

    // 4. В документе есть коды, а карточка «Без маркировки» — признак
    //    точно должен стоять (стратегия: признак = у товара есть КМ).
    //    Карточки без кодов на переходный период не трогаем — 99% склада
    //    это законные немаркированные остатки.
    if (
      (!pos.trackingType || pos.trackingType === "NOT_TRACKED") &&
      pos.trackingCodes.length > 0 &&
      classified.wave &&
      obligationOn(classified.wave, now).markingMandatory
    ) {
      findings.push({
        severity: "warn",
        code: "CARD_NOT_TRACKED",
        message: `«${pos.name}»: к позиции привязаны коды маркировки, но в карточке нет признака маркировки`,
        action: "Укажите в карточке признак предмета маркировки (и ТН ВЭД) — иначе касса не запросит скан и вывод из оборота не уйдёт.",
        positionName: pos.name,
      });
    }

    // 5. Особые случаи — подсказки.
    if (classified.special === "set" && countConsumerCodes(pos.trackingCodes) > 0) {
      findings.push({
        severity: "info",
        code: "SET_NOTICE",
        message: `«${pos.name}»: набор. У набора либо свой код комплекта, либо коды каждого вложения`,
        action: "Сверьтесь с инструкцией «Наборы» (docs/sop/40-sets.md): продажа набора с кодами вложений требует сканирования всех кодов.",
        positionName: pos.name,
      });
    }
  }

  return findings;
}

/** Считает потребительские коды (без транспортных упаковок). */
export function countConsumerCodes(codes: string[]): number {
  return codes.length;
}

/** Результат для светофора в интерфейсе менеджера. */
export function trafficLight(findings: Finding[]): "green" | "yellow" | "red" {
  if (findings.some((f) => f.severity === "block")) return "red";
  if (findings.some((f) => f.severity === "warn")) return "yellow";
  return "green";
}
