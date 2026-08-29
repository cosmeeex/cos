/**
 * CLI интеграции маркировки. Запуск: node src/cli.ts <команда> [аргументы]
 *
 * Команды:
 *   audit                    — аудит ассортимента МойСклад, отчёты в reports/
 *   audit --fix              — + проставить trackingType/ТН ВЭД (уважает DRY_RUN)
 *   plan-residuals           — план маркировки товара без кодов (Заказы КМ)
 *   plan-residuals --create  — + создать документы «Заказ КМ» в МойСклад
 *   reconcile                — сверка остатков МойСклад ↔ Честный знак
 *   distance                 — контроль вывода из оборота по интернет-заказам
 *   scan <код>               — проверить скан кода маркировки
 *   labels <файл> [zpl|tspl|csv] — этикетки из файла с кодами (по строке на код)
 *   setup-webhooks <url>     — включить вебхуки МойСклад на наш сервер
 *   serve                    — запустить сервер (вебхуки + панель)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, requireFor } from "./core/config.ts";
import { MoyskladClient, DOCS_WITH_TRACKING_CODES, idFromHref } from "./moysklad/client.ts";
import { auditAll, renderAuditMarkdown, extractGtins, type AuditableProduct } from "./classifier/audit.ts";
import { classify, obligationOn } from "./classifier/rules.ts";
import { planResiduals, renderResidualPlanMarkdown, type ResidualItem } from "./residuals/plan.ts";
import { toZpl, toTspl, toCsv } from "./residuals/labels.ts";
import { parseDataMatrix } from "./core/gs1.ts";
import { reconcile, renderReconcileMarkdown, type ChzStockLine } from "./reconcile/stocks.ts";
import { checkDistanceRetirement, type DemandSummary, type RetireOrderSummary } from "./guard/distance.ts";
import { TrueApiClient } from "./crpt/trueapi.ts";
import { SuzClient } from "./crpt/suz.ts";
import { ExternalSigner, StubSigner, RemoteSigner } from "./crpt/signer.ts";
import { HttpClient } from "./core/http.ts";
import { startServer } from "./server.ts";

const REPORTS_DIR = "reports";

/** Фильтр остатков по российским складам (MOYSKLAD_STORE_IDS). */
function stockParams(base: string): string {
  const cfg = loadConfig();
  if (cfg.moysklad.storeIds.length === 0) return base;
  const filter = cfg.moysklad.storeIds
    .map((id) => `store=${cfg.moysklad.baseUrl}/entity/store/${id}`)
    .join(";");
  return `${base}${base ? "&" : ""}filter=${encodeURIComponent(filter)}`;
}

/** Фильтр документов по юрлицу COSMEX Россия (MOYSKLAD_ORG_ID). */
function orgFilter(): string {
  const cfg = loadConfig();
  return cfg.moysklad.orgId
    ? `organization=${cfg.moysklad.baseUrl}/entity/organization/${cfg.moysklad.orgId}`
    : "";
}

/** Юрлицо для документов маркировки: COSMEX Россия (MOYSKLAD_ORG_ID). */
async function pickOrg(ms: MoyskladClient) {
  const cfg = loadConfig();
  const orgs = await ms.organizations();
  if (orgs.length === 0) throw new Error("В МойСклад нет юрлиц");
  if (cfg.moysklad.orgId) {
    const found = orgs.find((o) => (o.id ?? "") === cfg.moysklad.orgId || o.meta.href.includes(cfg.moysklad.orgId!));
    if (found) return found;
    throw new Error(`Юрлицо MOYSKLAD_ORG_ID=${cfg.moysklad.orgId} не найдено`);
  }
  return orgs[0];
}

function ensureReports(): void {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
}

function needMoysklad(): MoyskladClient {
  const cfg = loadConfig();
  const missing = requireFor(cfg, "moysklad");
  if (missing.length) {
    console.error(`Не хватает настроек МойСклад: ${missing.join(", ")}. Скопируйте .env.example в .env и заполните.`);
    process.exit(2);
  }
  return new MoyskladClient(cfg.moysklad, (l) => process.env.DEBUG && console.error(l));
}

function makeTrueApi(): TrueApiClient | null {
  const cfg = loadConfig();
  if (requireFor(cfg, "trueapi").length > 0) return null;
  const signer = cfg.crpt.signerCmd
    ? new ExternalSigner(cfg.crpt.signerCmd, cfg.crpt.certThumbprint)
    : cfg.server.signerSecret
      ? // Очередь подписи живёт в страже на этом же сервере.
        new RemoteSigner(`http://127.0.0.1:${cfg.server.port}`, cfg.server.signerSecret)
      : new StubSigner();
  return new TrueApiClient(new HttpClient(cfg.crpt.trueApiUrl), signer, (l) => console.error(l));
}

function makeSuz(): SuzClient | null {
  const cfg = loadConfig();
  if (requireFor(cfg, "suz").length > 0) return null;
  const signer = cfg.crpt.signerCmd
    ? new ExternalSigner(cfg.crpt.signerCmd, cfg.crpt.certThumbprint)
    : cfg.server.signerSecret
      ? new RemoteSigner(`http://127.0.0.1:${cfg.server.port}`, cfg.server.signerSecret)
      : new StubSigner();
  // clientToken для СУЗ = токен True API (markirovka) — тот же, что работает в cis-info.
  const trueApi = makeTrueApi();
  if (!trueApi) return null;
  return new SuzClient(
    new HttpClient(cfg.crpt.suzUrl),
    signer,
    cfg.crpt.omsId!,
    cfg.crpt.omsToken!,
    () => trueApi.ensureToken(),
  );
}

async function cmdSuzPing(productGroup?: string): Promise<void> {
  const cfg = loadConfig();
  const miss = requireFor(cfg, "suz");
  if (miss.length > 0) {
    console.error(`СУЗ не настроен: не хватает ${miss.join(", ")}`);
    process.exit(1);
  }
  const suz = makeSuz()!;
  const groups = productGroup ? [productGroup] : ["ncp", "perfumery", "beauty"];
  // 1090 не про токен — проверяем, не перепутаны ли omsId/connectionId: пробуем ОБА UUID как omsId.
  const omsCandidates = [
    { label: "CRPT_OMS_ID", val: cfg.crpt.omsId! },
    { label: "CRPT_OMS_TOKEN(connectionId)", val: cfg.crpt.omsToken! },
  ].filter((c, i, a) => a.findIndex((x) => x.val === c.val) === i);
  console.log(`СУЗ ping: url=${cfg.crpt.suzUrl}`);
  let anyOk = false;
  for (const oms of omsCandidates) {
    console.log(`\n— omsId = ${oms.val}  (${oms.label})`);
    for (const pg of groups) {
      try {
        const info = await suz.pingInfo(pg, oms.val);
        console.log(`  ✅ [${pg}] ответ СУЗ: ${JSON.stringify(info)}`);
        anyOk = true;
      } catch (err) {
        console.log(`  ✕ [${pg}] ${(err as Error).message.slice(0, 160)}`);
      }
    }
  }
  if (!anyOk) process.exit(1);
}

async function fetchAuditable(ms: MoyskladClient): Promise<AuditableProduct[]> {
  const products = await ms.allProducts();
  return products.map((p) => ({
    id: p.id ?? idFromHref(p.meta.href),
    name: p.name ?? "",
    pathName: p.pathName,
    tnved: p.tnved,
    trackingType: p.trackingType,
    archived: p.archived,
    barcodes: p.barcodes as Array<Record<string, string | undefined>>,
  }));
}

async function cmdAudit(fix: boolean): Promise<void> {
  const cfg = loadConfig();
  const ms = needMoysklad();
  console.log("Выгружаю товары из МойСклад…");
  const products = await fetchAuditable(ms);
  console.log(`Товаров: ${products.length}. Классифицирую…`);
  const report = auditAll(products);
  ensureReports();
  writeFileSync(join(REPORTS_DIR, "audit.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(REPORTS_DIR, "audit.md"), renderAuditMarkdown(report));
  console.log(
    `Готово: ${report.total} карточек, маркируемых ${report.tracked}, с проблемами ${report.rows.length}.\n` +
      `Отчёты: ${REPORTS_DIR}/audit.md, ${REPORTS_DIR}/audit.json`,
  );

  if (!fix) return;
  const fixable = report.rows.filter((r) =>
    r.issues.some((i) => i.code === "TRACKING_TYPE_MISSING") && r.classified.confidence >= 0.75,
  );
  console.log(`К исправлению (уверенность ≥0.75): ${fixable.length} карточек`);
  if (cfg.dryRun) {
    console.log("DRY_RUN=true — изменения не отправляются. Список: reports/audit-fix-plan.json");
    writeFileSync(
      join(REPORTS_DIR, "audit-fix-plan.json"),
      JSON.stringify(
        fixable.map((r) => ({
          id: r.product.id,
          name: r.product.name,
          set: { trackingType: r.classified.wave!.trackingType },
        })),
        null,
        2,
      ),
    );
    return;
  }
  let done = 0;
  for (const r of fixable) {
    await ms.updateProduct(r.product.id, { trackingType: r.classified.wave!.trackingType });
    done++;
    if (done % 50 === 0) console.log(`…${done}/${fixable.length}`);
  }
  console.log(`Обновлено карточек: ${done}`);
}

async function cmdPlanResiduals(create: boolean): Promise<void> {
  const cfg = loadConfig();
  const ms = needMoysklad();
  console.log("Выгружаю товары и остатки…");
  const products = await fetchAuditable(ms);
  const stock = await ms.stockAll(stockParams("stockMode=positiveOnly"));
  const stockByName = new Map(stock.map((s) => [s.name ?? "", s.stock]));

  const items: ResidualItem[] = [];
  const now = new Date();
  for (const p of products) {
    if (p.archived) continue;
    const c = classify(p);
    if (!c.wave || !obligationOn(c.wave, now).markingMandatory) continue;
    const qty = stockByName.get(p.name) ?? 0;
    if (qty <= 0) continue;
    items.push({
      productId: p.id,
      name: p.name,
      gtin: extractGtins(p)[0] ?? null,
      quantity: Math.floor(qty),
      trackingType: c.wave.trackingType,
      // По умолчанию — маркировка остатков; для собственного импорта СТМ
      // менеджер меняет способ на FOREIGN в созданном документе.
      emissionType: "REMAINS",
    });
  }
  const plan = planResiduals(items);
  ensureReports();
  writeFileSync(join(REPORTS_DIR, "residuals-plan.json"), JSON.stringify(plan, null, 2));
  writeFileSync(join(REPORTS_DIR, "residuals-plan.md"), renderResidualPlanMarkdown(plan, now.toISOString()));
  console.log(
    `План: ${plan.batches.length} заказов КМ, ${plan.totalCodes} кодов (~${plan.estimatedCostRub} ₽), отклонено ${plan.rejected.length}.\n` +
      `Отчёты: ${REPORTS_DIR}/residuals-plan.md`,
  );

  if (!create) return;
  if (cfg.dryRun) {
    console.log("DRY_RUN=true — документы не создаются. Снимите DRY_RUN, чтобы создать Заказы КМ.");
    return;
  }
  const org = await pickOrg(ms);
  const productMetaById = new Map(
    (await ms.allProducts()).map((p) => [p.id ?? idFromHref(p.meta.href), p.meta]),
  );
  for (const batch of plan.batches) {
    const positions = batch.positions
      .map((pos) => ({ assortmentMeta: productMetaById.get(pos.productId)!, quantity: pos.quantity }))
      .filter((p) => p.assortmentMeta);
    const doc = await ms.createEmissionOrder({
      organizationMeta: org.meta,
      trackingType: batch.trackingType,
      emissionType: batch.emissionType,
      name: batch.name,
      description:
        "Создан интеграцией маркировки. Дальше: «Заказать коды» → «Печать» → «Ввод в оборот». Инструкция: docs/sop/30-residuals.md",
      positions,
    });
    console.log(`Создан Заказ КМ: ${doc.name}`);
  }
}

async function cmdReconcile(): Promise<void> {
  const ms = needMoysklad();
  console.log("Выгружаю товары и остатки МойСклад…");
  const products = await fetchAuditable(ms);
  const stock = await ms.stockAll(stockParams("stockMode=positiveOnly"));
  const stockByName = new Map(stock.map((s) => [s.name ?? "", s.stock]));
  const now = new Date();

  const msLines = products
    .filter((p) => !p.archived)
    .flatMap((p) => {
      const c = classify(p);
      if (!c.wave || !obligationOn(c.wave, now).markingMandatory) return [];
      const gtin = extractGtins(p)[0];
      if (!gtin) return [];
      return [{ gtin, name: p.name, stock: Math.floor(stockByName.get(p.name) ?? 0) }];
    })
    .filter((l) => l.stock > 0);

  const trueApi = makeTrueApi();
  let chzLines: ChzStockLine[] = [];
  if (trueApi) {
    console.log("Запрашиваю коды «в обороте» в ГИС МТ…");
    const byGtin = new Map<string, number>();
    // Выгрузка по группам: perfumery и beauty (cosmetics).
    for (const pg of ["perfumery", "beauty"]) {
      try {
        const cises = await trueApi.cisList({ pg, status: "INTRODUCED", limit: "10000" });
        for (const c of cises) {
          const g = (c.gtin ?? "").padStart(14, "0");
          if (g) byGtin.set(g, (byGtin.get(g) ?? 0) + 1);
        }
      } catch (err) {
        console.error(`ГИС МТ, группа ${pg}: ${(err as Error).message}`);
      }
    }
    chzLines = [...byGtin].map(([gtin, n]) => ({ gtin, inCirculation: n }));
  } else {
    console.log(
      "True API не настроен (CRPT_SIGNER_CMD/CRPT_INN) — сверка только по стороне МойСклад.\n" +
        "Альтернатива: выгрузите из ЛК ЧЗ отчёт «Коды в обороте» в CSV и запустите reconcile-csv.",
    );
  }

  const discrepancies = reconcile(msLines, chzLines);
  ensureReports();
  writeFileSync(join(REPORTS_DIR, "reconcile.md"), renderReconcileMarkdown(discrepancies, now.toISOString()));
  writeFileSync(join(REPORTS_DIR, "reconcile.json"), JSON.stringify(discrepancies, null, 2));
  console.log(`Расхождений: ${discrepancies.length}. Отчёт: ${REPORTS_DIR}/reconcile.md`);
}

async function cmdDistance(): Promise<void> {
  const ms = needMoysklad();
  console.log("Выгружаю отгрузки за 14 дней и выводы из оборота…");
  const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 19);
  const of = orgFilter();
  const demandFilter = `moment>${since}` + (of ? `;${of}` : "");
  const demands: DemandSummary[] = [];
  for await (const d of ms.iterate<Record<string, never>>(
    "/entity/demand",
    `filter=${encodeURIComponent(demandFilter)}`,
    100,
  )) {
    const doc = d as unknown as { id: string; name: string; moment: string; agent?: { meta: { href: string } } };
    let codes = 0;
    try {
      const positions = await ms.documentPositions("demand", doc.id);
      for (const pos of positions) {
        const posId = pos.meta ? idFromHref(pos.meta.href) : "";
        if (!posId) continue;
        codes += (await ms.positionTrackingCodes("demand", doc.id, posId)).length;
      }
    } catch {
      // позиции без доступа пропускаем
    }
    demands.push({
      id: doc.id,
      name: doc.name,
      moment: new Date(doc.moment),
      trackedCodesCount: codes,
      // Розничность отгрузки определяем по контрагенту-физлицу в проде;
      // до настройки атрибутов считаем розничными все отгрузки с КМ.
      isRetailShipment: codes > 0,
    });
  }
  const retireOrders: RetireOrderSummary[] = [];
  for await (const r of ms.iterate<Record<string, never>>("/entity/retireorder", "", 100)) {
    const doc = r as unknown as RetireOrderSummary & { id: string; name: string };
    retireOrders.push(doc);
  }
  const findings = checkDistanceRetirement(demands, retireOrders);
  ensureReports();
  writeFileSync(join(REPORTS_DIR, "distance.json"), JSON.stringify(findings, null, 2));
  if (findings.length === 0) {
    console.log("Все отгрузки с КМ закрыты выводом из оборота ✅");
  } else {
    for (const f of findings) console.log(`[${f.status}] ${f.message}`);
    console.log(`Всего: ${findings.length}. Детали: ${REPORTS_DIR}/distance.json`);
  }
}

function cmdScan(code: string): void {
  const parsed = parseDataMatrix(code);
  console.log(JSON.stringify(parsed, null, 2));
  if (parsed.issues.length > 0) {
    console.log("\n❌ Код не прошёл проверку — см. issues выше.");
    process.exitCode = 1;
  } else if (parsed.truncation.length > 0) {
    console.log(`\n⚠️ Код сокращённый (${parsed.truncation.join(", ")}). Для сверки годится; для приёмки/отгрузки сканируйте полный DataMatrix.`);
  } else {
    console.log("\n✅ Код структурно корректен. Статус в ГИС МТ проверяйте перед продажей (касса/True API).");
  }
}

async function cmdCisInfo(file?: string): Promise<void> {
  const trueApi = makeTrueApi();
  if (!trueApi) {
    console.error(
      "True API не настроен: нужен SIGNER_SECRET (офисный подписант должен быть онлайн) либо CRPT_SIGNER_CMD.",
    );
    process.exit(1);
  }
  if (!file) {
    console.error("Использование: node src/cli.ts cis-info <файл-с-кодами>  (по одному коду в строке)");
    process.exit(1);
  }
  const raw = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // Код идентификации (КИ) = 01+GTIN+21+serial — часть до первого разделителя GS (0x1d).
  const kis = raw.map((l) => l.split("")[0]);
  console.log(`Проверяю ${kis.length} кодов в ГИС МТ (cises/info)…`);
  const infos = await trueApi.cisesInfo(kis);
  const byStatus = new Map<string, number>();
  const found = new Set<string>();
  for (const inf of infos) {
    if (!inf || typeof inf !== "object") continue;
    const st = (inf.status as string) ?? "(нет статуса)";
    byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
    if (inf.cis) found.add(String(inf.cis));
    console.log(
      `${String(inf.cis ?? "?").slice(0, 31)}  статус=${st}  ` +
        `владелец=${inf.ownerInn ?? "—"} ${inf.ownerName ?? ""}  ${inf.productName ?? ""}`.trimEnd(),
    );
  }
  console.log("\nИтого по статусам:");
  for (const [st, n] of [...byStatus].sort((a, b) => b[1] - a[1])) console.log(`  ${st}: ${n}`);
  const notFound = kis.filter((k) => ![...found].some((f) => k.startsWith(f) || f.startsWith(k)));
  if (infos.length < kis.length || notFound.length > 0) {
    console.log(`  НЕ НАЙДЕНО в ГИС МТ: ${Math.max(kis.length - infos.length, notFound.length)}`);
  }
}

function cmdLabels(file: string, format: string): void {
  const codes = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const jobs = codes.map((code) => {
    const parsed = parseDataMatrix(code);
    return { code, productName: "", gtin: parsed.gtin ?? "" };
  });
  ensureReports();
  const out =
    format === "tspl" ? toTspl(jobs) : format === "csv" ? toCsv(jobs) : toZpl(jobs);
  const target = join(REPORTS_DIR, `labels.${format || "zpl"}`);
  writeFileSync(target, out, "binary");
  console.log(`Этикеток: ${jobs.length}. Файл: ${target}`);
}

async function cmdSetupWebhooks(baseUrl: string): Promise<void> {
  const cfg = loadConfig();
  const ms = needMoysklad();
  // Секрет — сегментом пути: МойСклад дописывает ?requestId к URL,
  // и query-параметры в зарегистрированном адресе ломаются.
  const clean = baseUrl.replace(/\/+$/, "");
  const prefix = cfg.server.webhookSecret
    ? `${clean}/webhook/${cfg.server.webhookSecret}`
    : `${clean}/webhook`;
  const wanted = [...DOCS_WITH_TRACKING_CODES].flatMap((entityType) => [
    { entityType, action: "CREATE" as const },
    { entityType, action: "UPDATE" as const },
  ]);
  if (cfg.dryRun) {
    console.log("DRY_RUN=true — вебхуки не создаются. Планировались:");
    for (const w of wanted) console.log(`  ${w.entityType} ${w.action} → ${prefix}/${w.entityType}/${w.action.toLowerCase()}`);
    return;
  }
  const res = await ms.ensureWebhooks(prefix, wanted);
  console.log(`Вебхуки: создано ${res.created}, уже были ${res.kept}, удалено устаревших ${res.removed}`);
}

async function cmdDupCreate(file: string): Promise<void> {
  const cfg = loadConfig();
  const ms = needMoysklad();
  const { parseDupCsv, planDuplicates, DUP_MARKER, dupName } = await import("./residuals/duplicates.ts");
  const requests = parseDupCsv(readFileSync(file, "utf8"));
  console.log(`Заявок на дубли: ${requests.length}. Выгружаю товары и остатки…`);

  const products = await ms.allProducts();
  const stock = await ms.stockAll(stockParams("stockMode=positiveOnly"));
  const stockByName = new Map(stock.map((s) => [s.name ?? "", s.stock]));
  const lite = products.map((p) => ({
    id: p.id ?? idFromHref(p.meta.href),
    name: p.name ?? "",
    archived: p.archived,
    trackingType: p.trackingType,
    stock: Math.floor(stockByName.get(p.name ?? "") ?? 0),
  }));
  const actions = planDuplicates(requests, lite);

  for (const a of actions.filter((x) => x.kind === "reject")) {
    console.log(`✗ ${a.sourceName}: ${a.reason}`);
  }
  const work = actions.filter((a) => a.kind !== "reject");
  if (cfg.dryRun) {
    console.log("DRY_RUN=true — план без изменений:");
    for (const a of work) console.log(`  ${a.kind}: «${a.sourceName}» → «${a.dupNameResolved}» × ${a.quantity}`);
    return;
  }

  const org = await pickOrg(ms);
  const cfgStores = loadConfig().moysklad.storeIds;
  const allStores = await ms.stores();
  const store = cfgStores.length
    ? allStores.find((s) => cfgStores.includes(s.id ?? "")) ?? allStores[0]
    : allStores[0];
  const byName = new Map(products.map((p) => [p.name ?? "", p]));

  for (const a of work) {
    const source = byName.get(a.sourceName)!;
    if (a.kind === "create_dup") {
      const dup = await ms.createEntity("product", {
        name: a.dupNameResolved,
        article: source.article ? `${source.article}-NM` : undefined,
        uom: (source as Record<string, unknown>).uom,
        salePrices: (source as Record<string, unknown>).salePrices,
        productFolder: source.productFolder,
        description: `${DUP_MARKER} Немаркированные остатки товара «${a.sourceName}». Создан интеграцией маркировки ${new Date().toISOString().slice(0, 10)}. Продажа без сканирования кода. После распродажи карточка архивируется автоматически (SOP 30).`,
      });
      byName.set(a.dupNameResolved, dup as typeof source);
      console.log(`+ дубль создан: «${a.dupNameResolved}»`);
    }
    if (a.kind === "transfer") {
      const dup = byName.get(a.dupNameResolved);
      if (!dup) {
        console.log(`✗ перенос «${a.sourceName}»: дубль не найден`);
        continue;
      }
      const positionsOf = (meta: typeof source.meta) => [
        { assortment: { meta }, quantity: a.quantity },
      ];
      const note = `Перенос немаркированного остатка на «${a.dupNameResolved}» (интеграция маркировки)`;
      await ms.createEntity("loss", {
        organization: { meta: org.meta },
        store: { meta: store.meta },
        description: note,
        positions: positionsOf(source.meta),
      });
      await ms.createEntity("enter", {
        organization: { meta: org.meta },
        store: { meta: store.meta },
        description: note,
        positions: positionsOf(dup.meta),
      });
      console.log(`→ перенесено ${a.quantity} шт: «${a.sourceName}» → «${a.dupNameResolved}»`);
    }
  }
  console.log("Готово. Пометьте перенесённые единицы на полке стикером «остаток» (SOP 20/30).");
}

async function cmdDupReport(close: boolean): Promise<void> {
  const cfg = loadConfig();
  const ms = needMoysklad();
  const { isDupName, dupHealth } = await import("./residuals/duplicates.ts");
  const products = await ms.allProducts();
  const stock = await ms.stockAll(stockParams(""));
  const stockByName = new Map(stock.map((s) => [s.name ?? "", s.stock]));
  const dups = products
    .filter((p) => !p.archived && isDupName(p.name ?? ""))
    .map((p) => ({
      id: p.id ?? idFromHref(p.meta.href),
      meta: p.meta,
      name: p.name ?? "",
      stock: Math.floor(stockByName.get(p.name ?? "") ?? 0),
      createdAt: (p as Record<string, unknown>).updated as string | undefined,
    }));
  if (dups.length === 0) {
    console.log("Карточек-дублей «(немарк.)» нет.");
    return;
  }
  const health = dupHealth(dups);
  for (const h of health) {
    console.log(`[${h.verdict}] «${h.name}» остаток ${h.stock}${h.note ? ` — ${h.note}` : ""}`);
  }
  if (!close) return;
  const toArchive = health.filter((h) => h.verdict === "archive");
  if (cfg.dryRun) {
    console.log(`DRY_RUN=true — к архивации ${toArchive.length} дублей, изменения не отправлены.`);
    return;
  }
  for (const h of toArchive) {
    const dup = dups.find((d) => d.name === h.name)!;
    await ms.updateProduct(dup.id, { archived: true });
    console.log(`архивирован: «${h.name}»`);
  }
}

const [, , command, ...args] = process.argv;

switch (command) {
  case "audit":
    await cmdAudit(args.includes("--fix"));
    break;
  case "plan-residuals":
    await cmdPlanResiduals(args.includes("--create"));
    break;
  case "reconcile":
    await cmdReconcile();
    break;
  case "distance":
    await cmdDistance();
    break;
  case "scan":
    cmdScan(args.join(" "));
    break;
  case "cis-info":
    await cmdCisInfo(args[0]);
    break;
  case "suz-ping":
    await cmdSuzPing(args[0]);
    break;
  case "labels":
    cmdLabels(args[0], args[1] ?? "zpl");
    break;
  case "dup-create":
    await cmdDupCreate(args[0]);
    break;
  case "dup-report":
    await cmdDupReport(args.includes("--close"));
    break;
  case "setup-webhooks":
    await cmdSetupWebhooks(args[0]);
    break;
  case "serve":
    startServer();
    break;
  default:
    console.log(
      [
        "Интеграция маркировки «Честный знак» × МойСклад (Cosmex)",
        "",
        "Команды:",
        "  node src/cli.ts audit [--fix]",
        "  node src/cli.ts plan-residuals [--create]",
        "  node src/cli.ts reconcile",
        "  node src/cli.ts distance",
        "  node src/cli.ts scan <код>",
        "  node src/cli.ts cis-info <файл-с-кодами>   # статус кодов в ГИС МТ (True API)",
        "  node src/cli.ts suz-ping [productGroup]    # проверка связи и реквизитов СУЗ",
        "  node src/cli.ts labels <файл-с-кодами> [zpl|tspl|csv]",
        "  node src/cli.ts dup-create <файл.csv>   # «название;кол-во» — дубли (немарк.)",
        "  node src/cli.ts dup-report [--close]    # состояние дублей, архив пустых",
        "  node src/cli.ts setup-webhooks <публичный URL сервера>",
        "  node src/cli.ts serve",
        "",
        "Настройки: скопируйте .env.example в .env. По умолчанию DRY_RUN=true.",
      ].join("\n"),
    );
}
