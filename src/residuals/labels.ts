/**
 * Генерация заданий на печать этикеток с DataMatrix.
 *
 * Основной путь печати — кнопка «Печать» в Заказе КМ МойСклад. Этот модуль —
 * запасной и для допечатки: строит файлы для термопринтеров напрямую из кодов:
 *   — ZPL (Zebra и совместимые): команда ^BX печатает DataMatrix нативно;
 *   — TSPL (TSC и совместимые): команда DMATRIX;
 *   — CSV для импорта в дизайнеры этикеток (BarTender, NiceLabel).
 *
 * Размер по умолчанию 58×40 мм, разрешение 203 dpi (8 точек/мм).
 * КМ передаётся с GS-разделителями; в ZPL GS кодируется как _1D при ^FH.
 */
import { normalizeScan, parseDataMatrix, GS } from "../core/gs1.ts";

export interface LabelJob {
  /** Полный код маркировки (с криптохвостом). */
  code: string;
  productName: string;
  gtin: string;
}

export interface LabelOptions {
  widthMm?: number;
  heightMm?: number;
  dpmm?: number; // точек на мм: 8 = 203dpi, 12 = 300dpi
}

const esc = (s: string) => s.replace(/[\^~\\]/g, " ");

/** ZPL II: одна этикетка на код. */
export function toZpl(jobs: LabelJob[], opts: LabelOptions = {}): string {
  const dpmm = opts.dpmm ?? 8;
  const w = Math.round((opts.widthMm ?? 58) * dpmm);
  const h = Math.round((opts.heightMm ?? 40) * dpmm);
  const out: string[] = [];
  for (const job of jobs) {
    const code = normalizeScan(job.code);
    // ^FH_ включает hex-режим: GS (0x1D) передаётся как _1D.
    const data = code.split(GS).join("_1D");
    const name = esc(job.productName).slice(0, 40);
    out.push(
      [
        "^XA",
        `^PW${w}`,
        `^LL${h}`,
        "^CI28", // UTF-8 для кириллицы
        `^FO${Math.round(dpmm * 2)},${Math.round(dpmm * 2)}`,
        `^BXN,${Math.max(4, Math.round(dpmm * 0.9))},200`, // DataMatrix, ECC200
        `^FH_^FD${data}^FS`,
        `^FO${Math.round(dpmm * 26)},${Math.round(dpmm * 4)}^A0N,${Math.round(dpmm * 2.5)},${Math.round(dpmm * 2.5)}^FB${w - Math.round(dpmm * 28)},4,0,L^FD${name}^FS`,
        `^FO${Math.round(dpmm * 26)},${h - Math.round(dpmm * 6)}^A0N,${Math.round(dpmm * 2)},${Math.round(dpmm * 2)}^FD${job.gtin}^FS`,
        "^XZ",
      ].join("\n"),
    );
  }
  return out.join("\n");
}

/** TSPL (TSC): одна этикетка на код. */
export function toTspl(jobs: LabelJob[], opts: LabelOptions = {}): string {
  const wMm = opts.widthMm ?? 58;
  const hMm = opts.heightMm ?? 40;
  const dpmm = opts.dpmm ?? 8;
  const out: string[] = [];
  for (const job of jobs) {
    const code = normalizeScan(job.code);
    const name = job.productName.replace(/"/g, "'").slice(0, 40);
    out.push(
      [
        `SIZE ${wMm} mm,${hMm} mm`,
        "GAP 2 mm,0",
        "DIRECTION 1",
        "CODEPAGE UTF-8",
        "CLS",
        // TSPL: GS внутри строки задаётся как \[d029] нельзя — используем
        // экранирование через выражение с CHR недоступно в чистом TSPL,
        // поэтому печатаем DMATRIX с содержимым как есть: драйвер обязан
        // передать байт 0x1D. Файл пишем в бинарном виде с реальным GS.
        `DMATRIX ${Math.round(dpmm * 2)},${Math.round(dpmm * 2)},${Math.round(dpmm * 22)},${Math.round(dpmm * 22)},"${code}"`,
        `TEXT ${Math.round(dpmm * 26)},${Math.round(dpmm * 4)},"0",0,7,7,"${name}"`,
        `TEXT ${Math.round(dpmm * 26)},${Math.round(dpmm * (hMm - 6))},"0",0,6,6,"${job.gtin}"`,
        "PRINT 1",
      ].join("\n"),
    );
  }
  return out.join("\n");
}

/** CSV для дизайнеров этикеток: code;identity;gtin;serial;name. */
export function toCsv(jobs: LabelJob[]): string {
  const rows = ["code;identity;gtin;serial;name"];
  for (const job of jobs) {
    const parsed = parseDataMatrix(job.code);
    const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;
    rows.push(
      [
        cell(parsed.raw),
        cell(parsed.identityCode ?? ""),
        cell(parsed.gtin ?? job.gtin),
        cell(parsed.serial ?? ""),
        cell(job.productName),
      ].join(";"),
    );
  }
  return rows.join("\n");
}
