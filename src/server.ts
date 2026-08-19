/**
 * HTTP-сервер интеграции:
 *   — приём вебхуков МойСклад (ответ 200 мгновенно, обработка асинхронно —
 *     лимит МойСклад на ответ 1500 мс);
 *   — панель для менеджеров: светофор последних проверок документов;
 *   — проверка сканов: POST /scan для рабочего места (валидация кода).
 *
 * Запуск: node src/server.ts (переменные окружения — см. .env.example).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, requireFor } from "./core/config.ts";
import { MoyskladClient, idFromHref, type MsDocument, type DocumentPosition } from "./moysklad/client.ts";
import { checkDocument, trafficLight, type DocumentView, type Finding } from "./guard/checks.ts";
import { parseDataMatrix } from "./core/gs1.ts";
import { makeNotifier } from "./notify/telegram.ts";

const DATA_DIR = process.env.DATA_DIR ?? "data";

interface CheckRecord {
  at: string;
  docType: string;
  docId: string;
  docName: string;
  light: "green" | "yellow" | "red";
  findings: Finding[];
}

const recent: CheckRecord[] = [];

function persist(record: CheckRecord): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(join(DATA_DIR, "checks.jsonl"), JSON.stringify(record) + "\n");
}

function loadRecent(): void {
  const file = join(DATA_DIR, "checks.jsonl");
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").trim().split("\n").slice(-200);
  for (const line of lines) {
    try {
      recent.push(JSON.parse(line));
    } catch {
      // битые строки журнала пропускаем
    }
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Собирает DocumentView из документа МойСклад для стража. */
async function toDocumentView(
  ms: MoyskladClient,
  docType: string,
  docId: string,
): Promise<{ view: DocumentView; doc: MsDocument }> {
  const doc = await ms.document(docType as never, docId);
  const rows: DocumentPosition[] =
    doc.positions?.rows ?? (await ms.documentPositions(docType as never, docId));
  const positions = [];
  for (const row of rows) {
    const assortment = row.assortment as Record<string, unknown>;
    const positionId = row.meta ? idFromHref(row.meta.href) : "";
    let codes = (row.trackingCodes as Array<{ cis: string }> | undefined)?.map((c) => c.cis);
    if (!codes && positionId) {
      try {
        codes = (await ms.positionTrackingCodes(docType as never, docId, positionId)).map((c) => c.cis);
      } catch {
        codes = [];
      }
    }
    positions.push({
      name: (assortment?.name as string) ?? "(позиция)",
      pathName: assortment?.pathName as string | undefined,
      tnved: assortment?.tnved as string | undefined,
      trackingType: assortment?.trackingType as string | undefined,
      quantity: row.quantity,
      trackingCodes: codes ?? [],
      gtins: ((assortment?.barcodes as Array<Record<string, string>>) ?? [])
        .flatMap((b) => [b.gtin, b.ean13])
        .filter((x): x is string => Boolean(x))
        .map((x) => x.padStart(14, "0")),
    });
  }
  return {
    view: { docType, name: doc.name, moment: doc.moment ? new Date(doc.moment) : undefined, positions },
    doc,
  };
}

export function startServer(): void {
  const cfg = loadConfig();
  const missing = requireFor(cfg, "moysklad");
  const ms = missing.length === 0 ? new MoyskladClient(cfg.moysklad) : null;
  const notifier = makeNotifier(cfg);
  loadRecent();

  const queue: Array<{ docType: string; docId: string }> = [];
  let processing = false;

  async function processQueue(): Promise<void> {
    if (processing) return;
    processing = true;
    try {
      while (queue.length > 0) {
        const { docType, docId } = queue.shift()!;
        if (!ms) continue;
        try {
          const { view, doc } = await toDocumentView(ms, docType, docId);
          const findings = checkDocument(view);
          const record: CheckRecord = {
            at: new Date().toISOString(),
            docType,
            docId,
            docName: doc.name ?? docId,
            light: trafficLight(findings),
            findings,
          };
          recent.push(record);
          if (recent.length > 500) recent.splice(0, recent.length - 500);
          persist(record);
          if (record.light === "red") {
            const top = findings
              .filter((f) => f.severity === "block")
              .slice(0, 5)
              .map((f) => `— ${f.message}\n  ${f.action}`)
              .join("\n");
            await notifier.send(
              `🔴 Маркировка: документ ${docType} «${record.docName}» содержит блокирующие ошибки:\n${top}`,
            );
          }
        } catch (err) {
          console.error(`Ошибка обработки ${docType}/${docId}:`, err);
        }
      }
    } finally {
      processing = false;
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      // Вебхуки МойСклад: /webhook/{entityType}/{action}
      if (req.method === "POST" && url.pathname.startsWith("/webhook/")) {
        if (cfg.server.webhookSecret && url.searchParams.get("secret") !== cfg.server.webhookSecret) {
          res.writeHead(403).end();
          return;
        }
        const body = await readBody(req);
        res.writeHead(200).end(); // отвечаем сразу — у МойСклад таймаут 1500 мс
        try {
          const payload = JSON.parse(body) as {
            events?: Array<{ meta: { type: string; href: string }; action: string }>;
          };
          for (const ev of payload.events ?? []) {
            queue.push({ docType: ev.meta.type, docId: idFromHref(ev.meta.href) });
          }
          void processQueue();
        } catch {
          console.error("Вебхук: невалидный JSON");
        }
        return;
      }

      // Проверка скана с рабочего места: POST /scan {"code": "..."}
      if (req.method === "POST" && url.pathname === "/scan") {
        const body = await readBody(req);
        const { code } = JSON.parse(body) as { code: string };
        const parsed = parseDataMatrix(code ?? "");
        res
          .writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
          .end(JSON.stringify({ ok: parsed.issues.length === 0, ...parsed }));
        return;
      }

      // Панель менеджера.
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
        res
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(renderDashboard(recent, Boolean(ms)));
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ ok: true, moysklad: Boolean(ms), checks: recent.length }));
        return;
      }

      res.writeHead(404).end("not found");
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  server.listen(cfg.server.port, () => {
    console.log(`Страж маркировки: http://localhost:${cfg.server.port}`);
    if (!ms) {
      console.log(`МойСклад не подключён — задайте ${missing.join(", ")} (см. .env.example). Пока доступны /scan и панель.`);
    }
  });
}

const LIGHT_EMOJI = { green: "🟢", yellow: "🟡", red: "🔴" } as const;

function renderDashboard(records: CheckRecord[], msConnected: boolean): string {
  const rows = [...records]
    .reverse()
    .slice(0, 100)
    .map((r) => {
      const details = r.findings
        .map((f) => `<li class="${f.severity}"><b>${f.message}</b><br><small>${f.action}</small></li>`)
        .join("");
      return `<tr>
        <td>${LIGHT_EMOJI[r.light]}</td>
        <td>${new Date(r.at).toLocaleString("ru-RU")}</td>
        <td>${r.docType}</td>
        <td>${r.docName}</td>
        <td>${r.findings.length === 0 ? "ошибок нет" : `<details><summary>${r.findings.length} наход.</summary><ul>${details}</ul></details>`}</td>
      </tr>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Маркировка: страж документов</title>
<meta http-equiv="refresh" content="30">
<style>
 body{font-family:system-ui,sans-serif;margin:24px;background:#fafafa;color:#1a1a1a}
 h1{font-size:20px} table{border-collapse:collapse;width:100%;background:#fff}
 td,th{border:1px solid #ddd;padding:6px 10px;font-size:14px;text-align:left;vertical-align:top}
 th{background:#f0f0f0} ul{margin:4px 0;padding-left:18px}
 li.block{color:#b30000} li.warn{color:#8a6d00} li.info{color:#555}
 .status{margin:8px 0;padding:8px 12px;background:#fff;border:1px solid #ddd;display:inline-block}
</style></head><body>
<h1>Страж маркировки — последние проверки документов</h1>
<div class="status">МойСклад: ${msConnected ? "подключён ✅" : "не подключён ⚠️ (нет токена)"} · автообновление каждые 30 сек</div>
<table><tr><th></th><th>Когда</th><th>Документ</th><th>Название</th><th>Находки</th></tr>
${rows || "<tr><td colspan=5>Проверок ещё не было. Настройте вебхуки: node src/cli.ts setup-webhooks &lt;публичный URL&gt;</td></tr>"}
</table></body></html>`;
}

if (import.meta.url === `file://${process.argv[1]}`) startServer();
