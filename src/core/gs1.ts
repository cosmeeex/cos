/**
 * Разбор и валидация кодов маркировки «Честный знак» (GS1 DataMatrix).
 *
 * Код маркировки парфюмерии/косметики (поэкземплярный):
 *   01 <GTIN, 14 цифр> 21 <серийный номер, 13 симв.> <GS> 91 <ключ, 4 симв.> <GS> 92 <криптоподпись, 44 симв.>
 * Разделитель групп GS = ASCII 29 (). Сканер может отдавать его как есть,
 * подменять на видимую последовательность или терять вовсе.
 *
 * Модуль без зависимостей и без побочных эффектов — вся логика тестируема.
 */

export const GS = "";

/** Известные представления разделителя GS в сыром вводе от сканеров. */
const GS_ALIASES = [
  "",
  "\\u001d",
  "\\x1d",
  "\\x1D",
  "è", // некоторые сканеры в режиме ALT-кодов
  "<GS>",
  "(GS)",
  "[GS]",
  "␝", // символ-картинка SYMBOL FOR GROUP SEPARATOR
];

/** Префиксы FNC1, которые сканеры добавляют в начало кода. */
const FNC1_PREFIXES = ["]d2", "]C1", "]Q3", "]e0", "è"];

/**
 * Таблица идентификаторов применения GS1, встречающихся в КМ «Честного знака».
 * fixed = фиксированная длина значения; иначе значение до GS или конца строки.
 */
const AI_TABLE: Record<string, { fixed?: number; max: number; name: string }> = {
  "01": { fixed: 14, max: 14, name: "GTIN" },
  "02": { fixed: 14, max: 14, name: "GTIN содержимого" },
  "10": { max: 20, name: "Номер партии" },
  "17": { fixed: 6, max: 6, name: "Годен до (ГГММДД)" },
  "21": { max: 20, name: "Серийный номер" },
  "240": { max: 30, name: "Доп. идентификация" },
  "37": { max: 8, name: "Количество" },
  "91": { max: 90, name: "Ключ проверки" },
  "92": { max: 90, name: "Криптоподпись" },
  "93": { max: 90, name: "Код проверки" },
  "8005": { fixed: 6, max: 6, name: "Цена за единицу" },
};

/** Соответствие русской раскладки латинской для «сломанных» сканов. */
const RU_TO_EN: Record<string, string> = {
  й: "q", ц: "w", у: "e", к: "r", е: "t", н: "y", г: "u", ш: "i", щ: "o", з: "p",
  х: "[", ъ: "]", ф: "a", ы: "s", в: "d", а: "f", п: "g", р: "h", о: "j", л: "k",
  д: "l", ж: ";", э: "'", я: "z", ч: "x", с: "c", м: "v", и: "b", т: "n", ь: "m",
  б: ",", ю: ".", Й: "Q", Ц: "W", У: "E", К: "R", Е: "T", Н: "Y", Г: "U", Ш: "I",
  Щ: "O", З: "P", Х: "{", Ъ: "}", Ф: "A", Ы: "S", В: "D", А: "F", П: "G", Р: "H",
  О: "J", Л: "K", Д: "L", Ж: ":", Э: "\"", Я: "Z", Ч: "X", С: "C", М: "V", И: "B",
  Т: "N", Ь: "M", Б: "<", Ю: ">", ё: "`", Ё: "~",
};

export interface ParsedMark {
  /** Исходная строка после нормализации (с GS-разделителями). */
  raw: string;
  /** GTIN — 14 цифр (AI 01). */
  gtin: string | null;
  /** Серийный номер (AI 21). */
  serial: string | null;
  /** Все распознанные идентификаторы применения: AI → значение. */
  ais: Record<string, string>;
  /** Код идентификации: (01)GTIN + (21)серия — то, что уходит в тег 1162/1163 и отчёты. */
  identityCode: string | null;
  /** Проблемы, найденные при разборе (пустой массив = код структурно валиден). */
  issues: string[];
}

/** Убирает префиксы FNC1, унифицирует GS, чинит русскую раскладку и невидимые символы. */
export function normalizeScan(input: string): string {
  let s = input.replace(/[\r\n\t]+$/g, "").replace(/^[\r\n\t]+/g, "");
  for (const p of FNC1_PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  for (const alias of GS_ALIASES) {
    if (alias !== GS) s = s.split(alias).join(GS);
  }
  // Скан в русской раскладке: кириллица там, где её быть не может.
  if (/[а-яА-ЯёЁ]/.test(s)) {
    s = s.replace(/[а-яА-ЯёЁ]/g, (ch) => RU_TO_EN[ch] ?? ch);
  }
  // Прочие управляющие символы, кроме GS, коду не принадлежат.
  s = [...s].filter((ch) => ch === GS || ch.charCodeAt(0) >= 32).join("");
  return s;
}

/** Контрольная цифра GTIN (GS1 mod 10). Вход — 14 цифр. */
export function isValidGtin(gtin: string): boolean {
  if (!/^\d{14}$/.test(gtin)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const d = gtin.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10 === gtin.charCodeAt(13) - 48;
}

/** Дополняет штрихкод (EAN-13/UPC/GTIN-8) до GTIN-14. */
export function toGtin14(barcode: string): string | null {
  const digits = barcode.trim();
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return null;
  return digits.padStart(14, "0");
}

/**
 * Разбирает нормализованную строку КМ на идентификаторы применения GS1.
 * Не бросает исключений: все проблемы складываются в issues.
 */
export function parseDataMatrix(input: string): ParsedMark {
  const raw = normalizeScan(input);
  const ais: Record<string, string> = {};
  const issues: string[] = [];
  let i = 0;

  while (i < raw.length) {
    if (raw[i] === GS) {
      i++;
      continue;
    }
    let ai: string | null = null;
    for (const len of [4, 3, 2]) {
      const candidate = raw.slice(i, i + len);
      if (AI_TABLE[candidate]) {
        ai = candidate;
        break;
      }
    }
    if (!ai) {
      issues.push(`Нераспознанный фрагмент с позиции ${i}: «${raw.slice(i, i + 8)}…»`);
      break;
    }
    i += ai.length;
    const spec = AI_TABLE[ai];
    let value: string;
    if (spec.fixed) {
      value = raw.slice(i, i + spec.fixed);
      if (value.length < spec.fixed) {
        issues.push(`AI ${ai} (${spec.name}): ожидалось ${spec.fixed} символов, получено ${value.length}`);
      }
      i += value.length;
    } else {
      const gsPos = raw.indexOf(GS, i);
      value = gsPos === -1 ? raw.slice(i) : raw.slice(i, gsPos);
      i += value.length;
      if (value.length > spec.max) {
        issues.push(`AI ${ai} (${spec.name}): длина ${value.length} больше максимума ${spec.max}`);
      }
    }
    if (ais[ai] !== undefined) issues.push(`AI ${ai} встречается дважды`);
    ais[ai] = value;
  }

  const gtin = ais["01"] ?? null;
  const serial = ais["21"] ?? null;

  if (!gtin) issues.push("Нет GTIN (AI 01) — это не код маркировки");
  else if (!isValidGtin(gtin)) issues.push(`GTIN ${gtin} не проходит проверку контрольной цифры`);
  if (!serial) issues.push("Нет серийного номера (AI 21)");
  else if (serial.length !== 13) {
    issues.push(`Серийный номер длиной ${serial.length}, для парфюмерии/косметики ожидается 13`);
  }
  if (serial && /[^!-~]/.test(serial)) {
    issues.push("Серийный номер содержит недопустимые символы — вероятно, скан повреждён");
  }
  if (gtin && serial && !ais["91"] && !ais["92"] && !ais["93"]) {
    issues.push("Нет криптохвоста (AI 91/92/93) — отсканирован сокращённый код, для приёмки/продажи нужен полный DataMatrix");
  }

  const identityCode = gtin && serial ? `01${gtin}21${serial}` : null;
  return { raw, gtin, serial, ais, identityCode, issues };
}

/** Полный код в base64 — формат, который принимает True API (cises/info, codes/check). */
export function toBase64Cis(rawMark: string): string {
  return Buffer.from(normalizeScan(rawMark), "utf8").toString("base64");
}

/** Код идентификации без криптохвоста, формат «01…21…» — ключ сверки между системами. */
export function identityOf(rawMark: string): string | null {
  return parseDataMatrix(rawMark).identityCode;
}

/** true, если два скана указывают на один и тот же экземпляр товара. */
export function sameInstance(a: string, b: string): boolean {
  const ia = identityOf(a);
  return ia !== null && ia === identityOf(b);
}
