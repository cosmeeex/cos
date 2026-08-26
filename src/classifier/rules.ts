/**
 * Классификатор маркируемости ассортимента cosmex.ru (товары для ногтевого
 * сервиса и салонов красоты).
 *
 * Определяет по названию/категории/ТН ВЭД товара:
 *   — товарную группу «Честного знака»;
 *   — волну обязательности и ключевые даты;
 *   — ожидаемый признак trackingType для МойСклад.
 *
 * Даты волн вынесены в таблицу WAVES и сверяются с docs/research.md —
 * при изменении нормативки правится только таблица.
 */

export type ChzGroup =
  | "perfumery" // духи и туалетная вода, ТН ВЭД 3303
  | "beauty" // парфюмерно-косметическая продукция и бытовая химия
  | "antiseptics" // кожные антисептики, своя товарная группа (с 2024)
  | "none";

export interface Wave {
  id: string;
  group: ChzGroup;
  title: string;
  /** Коды ТН ВЭД (префиксы). */
  tnved: string[];
  /** С какой даты маркировка обязательна для производителей/импортёров. */
  mandatoryFrom: string; // ISO date
  /** С какой даты запрещён оборот немаркированных (продажа розницей). */
  salesBanFrom: string | null;
  /** Крайний срок маркировки остатков (null = не объявлен / истёк). */
  remainsDeadline: string | null;
  /** Ожидаемое значение trackingType в МойСклад. */
  trackingType: string;
}

/**
 * Волны обязательной маркировки. Даты сверяются с docs/research.md
 * (первоисточник — постановления Правительства РФ и честныйзнак.рф).
 * ВАЖНО: перед боевым запуском повторно сверить даты — они меняются.
 */
export const WAVES: Wave[] = [
  {
    id: "perfumery-2020",
    group: "perfumery",
    title: "Духи и туалетная вода (ПП № 1957)",
    tnved: ["3303"],
    mandatoryFrom: "2020-10-01",
    salesBanFrom: "2021-10-01", // немаркированные остатки запрещены к продаже
    remainsDeadline: "2021-10-31", // окно остатков истекло
    trackingType: "PERFUMERY",
  },
  {
    id: "beauty-2025-w1",
    group: "beauty",
    title: "Косметика, этап 1 (ПП № 1681): мыло, моющие и чистящие средства",
    tnved: ["3401", "34025000", "34054000"],
    mandatoryFrom: "2025-05-01",
    // Остатки, произведённые/ввезённые до контрольной даты, продаются
    // без кодов до истечения срока годности (обязательной домаркировки нет).
    salesBanFrom: null,
    remainsDeadline: null,
    trackingType: "CHEMISTRY",
  },
  {
    id: "beauty-2025-w2",
    group: "beauty",
    title: "Косметика, этап 2 (ПП № 1681): средства для волос, бритья, дезодоранты",
    tnved: ["3305", "3307"], // искл.: 3307 41 000 0, 3307 90 000 1/2 — сверить с приложением к ПП
    mandatoryFrom: "2025-07-01",
    salesBanFrom: null,
    remainsDeadline: null,
    trackingType: "CHEMISTRY",
  },
  {
    id: "beauty-2025-w3",
    group: "beauty",
    title: "Косметика, этап 3 (ПП № 1681): уход, декоративная, средства для ногтей, полость рта",
    tnved: ["3304", "3306"], // искл. по приложению к ПП 1681 — сверить точный перечень
    mandatoryFrom: "2025-10-01",
    salesBanFrom: null,
    remainsDeadline: null,
    trackingType: "CHEMISTRY",
  },
  {
    id: "hygiene-2026",
    group: "beauty",
    title:
      "Личная гигиена (ПП № 656): зубные щётки, расчёски, пинцеты, маникюрные наборы, вата, мочалки",
    // Точные коды — из приложения к ПП № 656; здесь основные для ассортимента Cosmex.
    tnved: ["960321", "9615", "821420", "5601", "960329"],
    mandatoryFrom: "2026-11-01",
    salesBanFrom: null, // остатки и домаркировка — до 31.10.2027
    remainsDeadline: "2027-10-31",
    trackingType: "CHEMISTRY",
  },
  {
    id: "antiseptics-2024",
    group: "antiseptics",
    title: "Кожные антисептики",
    tnved: ["380894", "38089"],
    mandatoryFrom: "2024-03-01",
    salesBanFrom: "2024-05-01",
    remainsDeadline: "2024-04-30",
    trackingType: "SANITIZER",
  },
];

export interface ClassifiedItem {
  group: ChzGroup;
  wave: Wave | null;
  /** Уверенность 0..1: 1 — по ТН ВЭД, ниже — по ключевым словам. */
  confidence: number;
  /** Человекочитаемые причины решения. */
  reasons: string[];
  /** Особый случай, требующий ручного решения. */
  special:
    | null
    | "perfumed-mist" // парфюмированный мист: у Cosmex неспиртовые → косметика (3307/3304), не 3303
    | "set" // набор из нескольких товаров
    | "sample" // пробник/семпл
    | "tester" // тестер
    | "professional"; // профессиональная упаковка (объём для салонов)
}

interface Rule {
  wave: string;
  keywords: RegExp;
  confidence: number;
  reason: string;
}

const KEYWORD_RULES: Rule[] = [
  {
    wave: "perfumery-2020",
    keywords:
      /((?<![а-яёa-z])духи(?![а-яёa-z])|парфюмерн[а-яёa-z]+ вод[а-яёa-z]+|туалетн[а-яёa-z]+ вод[а-яёa-z]+|\bparfum\b|\bedp\b|\bedt\b|eau de parfum|eau de toilette|одеколон|\bcologne\b)/iu,
    confidence: 0.9,
    reason: "название указывает на парфюмерию (ТН ВЭД 3303)",
  },
  {
    wave: "antiseptics-2024",
    keywords: /(антисептик[а-яёa-z]*|дезинфицир[а-яёa-z]+|дезраствор[а-яёa-z]*|санитайзер[а-яёa-z]*)/iu,
    confidence: 0.8,
    reason: "кожные антисептики/дезинфекция (ТН ВЭД 3808 94) — своя товарная группа",
  },
  {
    wave: "beauty-2025-w1",
    keywords:
      /((?<![а-яёa-z])мыло(?![а-яёa-z])|гел[а-яёa-z]+ для душа|пен[а-яёa-z]+ для ванн|соль для ванн|бомбочк[а-яёa-z]+ для ванн|для стирки|для мытья посуды)/iu,
    confidence: 0.8,
    reason: "мыло и средства для ванн/душа (ТН ВЭД 3401/3402)",
  },
  {
    wave: "beauty-2025-w2",
    keywords:
      /(шампун[а-яёa-z]*|кондиционер[а-яёa-z]*|бальзам[а-яёa-z]* для волос|маск[а-яёa-z]+ для волос|крем[- ]краск[а-яёa-z]*|краск[а-яёa-z]+ для волос|осветл[а-яёa-z]+ (пудр[а-яёa-z]+|порош[а-яёa-z]+)|оксид[а-яёa-z]*|окислител[а-яёa-z]*|стайлинг|лак[а-яёa-z]* для волос|для укладки|ламинировани[а-яёa-z]+|кератин[а-яёa-z]*|дезодорант[а-яёa-z]*|антиперспирант[а-яёa-z]*|для бритья|после бритья|депиляц[а-яёa-z]*|воск для депиляц[а-яёa-z]*|шугаринг[а-яёa-z]*)/iu,
    confidence: 0.8,
    reason: "средства для волос / бритья / дезодоранты (ТН ВЭД 3305/3307)",
  },
  {
    wave: "hygiene-2026",
    keywords:
      /(зубн[а-яёa-z]+ (щетк|щётк|нит)[а-яёa-z]+|расческ[а-яёa-z]+|расчёск[а-яёa-z]+|гребен[а-яёa-z]+|пинцет[а-яёa-z]*|маникюрн[а-яёa-z]+ набор[а-яёa-z]*|пемз[а-яёa-z]+|мочалк[а-яёa-z]+|губк[а-яёa-z]+ для (тела|мытья)|ватн[а-яёa-z]+ (диск|палочк)[а-яёa-z]+|(?<![а-яёa-z])вата(?![а-яёa-z])|прокладк[а-яёa-z]+ (гигиен|ежеднев)[а-яёa-z]+|массажн[а-яёa-z]+ (прибор|щетк|щётк)[а-яёa-z]*)/iu,
    confidence: 0.75,
    reason:
      "товары личной гигиены (ПП № 656): маркировка производителями/импортёрами с 01.11.2026, остатки — до 31.10.2027",
  },
  {
    wave: "beauty-2025-w3",
    keywords:
      /(гель[- ]?лак[а-яёa-z]*|(?<![а-яёa-z])баз[а-яёa-z]+ (для|под) (гель|ногт)[а-яёa-z]*|камуфлирующ[а-яёa-z]+ баз[а-яёa-z]*|(?<![а-яёa-z])топ[а-яёa-z]* (для|без) (гель|липк)[а-яёa-z]*|праймер[а-яёa-z]*|дегидратор[а-яёa-z]*|бондер[а-яёa-z]*|(?<![а-яёa-z])лак[а-яёa-z]* для ногтей|полигел[а-яёa-z]*|акригел[а-яёa-z]*|акрил[а-яёa-z]+ (пудр[а-яёa-z]+|систем[а-яёa-z]+)|для наращивани[а-яёa-z]+|укреплени[а-яёa-z]+ ногтей|для кутикул[а-яёa-z]+|ремувер[а-яёa-z]*|обезжирива[а-яёa-z]+|снятия (гель|лак)[а-яёa-z]*|крем[а-яёa-z]*|сыворотк[а-яёa-z]*|лосьон[а-яёa-z]*|тоник[а-яёa-z]*|мицеллярн[а-яёa-z]*|скраб[а-яёa-z]*|пилинг[а-яёa-z]*|маск[а-яёa-z]+ для (лица|рук|ног)|патч[а-яёa-z]*|парафин[а-яёa-z]*|пенк[а-яёa-z]+ для (умывани[а-яёa-z]+|ног|лица)|бальзам[а-яёa-z]* для губ|помад[а-яёa-z]*|блеск для губ|(?<![а-яёa-z])тушь(?![а-яёa-z])|(?<![а-яёa-z])тени(?![а-яёa-z])|пудр[а-яёa-z]*|румян[а-яёa-z]*|консилер[а-яёa-z]*|хайлайтер[а-яёa-z]*|тональн[а-яёa-z]*|(?<![а-яёa-z])тинт[а-яёa-z]*|карандаш для (глаз|губ|бровей)|зубн[а-яёa-z]+ паст[а-яёa-z]*|ополаскиват[а-яёa-z]* (для )?полости рта|солнцезащитн[а-яёa-z]*|\bspf\b)/iu,
    confidence: 0.75,
    reason: "средства для ногтей / уход за кожей / декоративная косметика / полость рта (ТН ВЭД 3304/3306)",
  },
];

/** Явно немаркируемое: инструменты, оборудование, расходники, дизайн ногтей. */
const NOT_TRACKED_KEYWORDS =
  /(фрез[а-яёa-z]+|(?<![а-яёa-z])бор[а-яёa-z]* (алмазн|твердосплав)[а-яёa-z]*|полир[а-яёa-z]+|шлифовщик[а-яёa-z]*|колпач[а-яёa-z]+|пилк[а-яёa-z]+|(?<![а-яёa-z])баф[а-яёa-z]*|кусачк[а-яёa-z]+|книпсер[а-яёa-z]*|точилк[а-яёa-z]+|цанг[а-яёa-z]+|запчаст[а-яёa-z]+|ножниц[а-яёa-z]+|пушер[а-яёa-z]*|кюретк[а-яёa-z]*|лопатк[а-яёa-z]+|станок|заточк[а-яёa-z]+|аппарат[а-яёa-z]* (для маникюра|фрезер)[а-яёa-z]*|(?<![а-яёa-z])ламп[а-яёa-z]+ (uv|led|уф)[а-яёa-z]*|стерилизатор[а-яёa-z]*|сухожар[а-яёa-z]*|пылесос[а-яёa-z]*|вытяжк[а-яёa-z]+|воскоплав[а-яёa-z]*|страз[а-яёa-z]*|слайдер[а-яёa-z]*|фольг[а-яёa-z]+|наклейк[а-яёa-z]+|дизайн[а-яёa-z]* ногтей|типс[а-яёa-z]+|формы для наращивани[а-яёa-z]*|кист[а-яёa-z]+ (для|№)|спонж[а-яёa-z]*|аппликатор[а-яёa-z]*|палочк[а-яёa-z]+ апельсинов[а-яёa-z]*|салфетк[а-яёa-z]+|безворсов[а-яёa-z]+|перчатк[а-яёa-z]+|маск[а-яёa-z]+ (медицинск|одноразов)[а-яёa-z]*|крафт[- ]пакет[а-яёa-z]*|пакет[а-яёa-z]+ для стерилизаци[а-яёa-z]*|индикатор[а-яёa-z]+ стерилизаци[а-яёa-z]*|простын[а-яёa-z]+|шапочк[а-яёa-z]+|бахил[а-яёa-z]+|валик[а-яёa-z]*|подлокотник[а-яёa-z]*|униформ[а-яёa-z]*|фартук[а-яёa-z]*|свеч[а-яёa-z]+ (ароматическ|соев)[а-яёa-z]*|аромасвеч[а-яёa-z]*|отдушк[а-яёa-z]+|диффузор[а-яёa-z]*|флакон[а-яёa-z]* (пуст|стекл)[а-яёa-z]*|(?<![а-яёa-z])тара(?![а-яёa-z])|бутылочк[а-яёa-z]+ пуст[а-яёa-z]*|дозатор[а-яёa-z]* пуст[а-яёa-z]*|косметичк[а-яёa-z]*|зеркал[а-яёa-z]*|заколк[а-яёa-z]+|резинк[а-яёa-z]+ для волос|бигуди|штатив[а-яёa-z]*|органайзер[а-яёa-z]*|подставк[а-яёa-z]+)/iu;

const SPECIAL_PATTERNS: Array<{ special: NonNullable<ClassifiedItem["special"]>; re: RegExp }> = [
  { special: "perfumed-mist", re: /((?<![а-яёa-z])мист[а-яёa-z]*|\bmist\b|по мотивам)/iu },
  { special: "set", re: /((?<![а-яёa-z])набор[а-яёa-z]*|\bset\b|\bkit\b|шампунь\s*\+|2\s*[x×]\s*\d)/iu },
  { special: "tester", re: /((?<![а-яёa-z])тестер[а-яёa-z]*|\btester\b)/iu },
  { special: "sample", re: /((?<![а-яёa-z])пробник[а-яёa-z]*|сэмпл[а-яёa-z]*|семпл[а-яёa-z]*|\bsample\b)/iu },
  { special: "professional", re: /(1000 мл|(?<![0-9])5 л(?![а-яёa-z])|(?<![а-яёa-z])проф(\.|(?![а-яёa-z]))|professional)/iu },
];

export function waveById(id: string): Wave | null {
  return WAVES.find((w) => w.id === id) ?? null;
}

export function waveByTnved(tnved: string): Wave | null {
  const clean = tnved.replace(/\D/g, "");
  if (!clean) return null;
  // Сначала самый длинный префикс (антисептики 380894 специфичнее 3808).
  const matches = WAVES.flatMap((w) =>
    w.tnved.filter((p) => clean.startsWith(p)).map((p) => ({ wave: w, len: p.length })),
  );
  matches.sort((a, b) => b.len - a.len);
  return matches[0]?.wave ?? null;
}

/**
 * Классифицирует товар. Вход — что есть в МойСклад: название, путь папки, ТН ВЭД.
 */
export function classify(item: {
  name: string;
  pathName?: string | null;
  tnved?: string | null;
}): ClassifiedItem {
  const text = `${item.pathName ?? ""} / ${item.name}`;
  const reasons: string[] = [];
  const path = item.pathName ?? "";

  // 0. Служебные папки: этикетки, сырьё, заготовки — не товары для продажи.
  if (/^(производство|служебн|списан)/iu.test(path)) {
    reasons.push("служебная папка (производство/заготовки) — не товар для розничной продажи, маркировка не требуется");
    return { group: "none", wave: null, confidence: 0.9, reasons, special: null };
  }
  // Папка оборудования: аппараты, лампы, запчасти.
  if (/\/оборудование(\/|$)/iu.test(path)) {
    reasons.push("оборудование и запчасти — маркировке не подлежат");
    return { group: "none", wave: null, confidence: 0.85, reasons, special: null };
  }

  let special: ClassifiedItem["special"] = null;
  for (const s of SPECIAL_PATTERNS) {
    if (s.re.test(text)) {
      special = s.special;
      break;
    }
  }

  // 1. Точный ТН ВЭД, если заполнен, — главный источник истины.
  if (item.tnved) {
    const wave = waveByTnved(item.tnved);
    if (wave) {
      reasons.push(`ТН ВЭД ${item.tnved} входит в волну «${wave.title}»`);
      return { group: wave.group, wave, confidence: 1, reasons, special };
    }
    reasons.push(`ТН ВЭД ${item.tnved} не входит в известные волны маркировки`);
    return { group: "none", wave: null, confidence: 0.95, reasons, special };
  }

  // 2. Явные немаркируемые категории (инструменты, оборудование, расходники).
  if (NOT_TRACKED_KEYWORDS.test(text)) {
    reasons.push("инструменты/оборудование/расходники/аксессуары — маркировке не подлежат");
    return { group: "none", wave: null, confidence: 0.85, reasons, special };
  }

  // 3. Ключевые слова по волнам. Порядок: парфюмерия и антисептики первыми
  //    (уже действуют), затем волны косметики от специфичного к общему.
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.test(text)) {
      const wave = waveById(rule.wave)!;
      reasons.push(rule.reason);
      // Мисты Cosmex неспиртовые (подтверждено владельцем 19.08.2026) —
      // это косметика (3307/3304), не парфюмерия. Спиртовой мист был бы 3303.
      if (special === "perfumed-mist" && wave.group !== "perfumery") {
        reasons.push(
          "мист: неспиртовой (подтверждено) → косметика; точный ТН ВЭД (3307/3304) проставить из декларации. Спиртовые мисты, если появятся, — это 3303 (парфюмерия)",
        );
      }
      return { group: wave.group, wave, confidence: rule.confidence, reasons, special };
    }
  }

  if (special === "perfumed-mist") {
    reasons.push(
      "неспиртовой парфюмированный мист (подтверждено 19.08.2026) — косметика, волна 2 (3307); проставить ТН ВЭД из декларации",
    );
    return { group: "beauty", wave: waveById("beauty-2025-w2"), confidence: 0.75, reasons, special };
  }

  reasons.push("не удалось определить по названию и категории — нужна ручная проверка и заполнение ТН ВЭД");
  return { group: "none", wave: null, confidence: 0.3, reasons, special };
}

/** Статус обязательности для волны на дату. */
export function obligationOn(
  wave: Wave,
  onDate: Date,
): {
  markingMandatory: boolean;
  salesBanned: boolean;
  remainsWindowOpen: boolean;
} {
  const d = onDate.toISOString().slice(0, 10);
  return {
    markingMandatory: d >= wave.mandatoryFrom,
    salesBanned: wave.salesBanFrom !== null && d >= wave.salesBanFrom,
    remainsWindowOpen: wave.remainsDeadline !== null && d <= wave.remainsDeadline,
  };
}
