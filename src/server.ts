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
import { makeNotifier, currentChatId, resolveChatMigration } from "./notify/telegram.ts";
import { SignQueue } from "./crpt/signqueue.ts";

const DATA_DIR = process.env.DATA_DIR ?? "data";

/** Сообщение Telegram (минимальный срез полей, которые нам нужны). */
interface TgMessage {
  message_id: number;
  date: number;
  chat?: { id: number };
  from?: { first_name?: string; last_name?: string; username?: string };
  text?: string;
  caption?: string;
  document?: { file_id: string; file_name?: string; mime_type?: string };
  photo?: Array<{ file_id: string }>;
  video?: { file_id: string; mime_type?: string };
  video_note?: { file_id: string };
  voice?: { file_id: string; mime_type?: string };
  audio?: { file_id: string; file_name?: string; mime_type?: string };
  animation?: { file_id: string; file_name?: string; mime_type?: string };
  sticker?: { emoji?: string };
  reply_to_message?: { message_id: number };
}

/** Единый взгляд на вложение сообщения Telegram (что скачивать через getFile). */
function tgAttachment(msg: TgMessage): { file_id: string; name: string; mime: string } | undefined {
  if (msg.document) return { file_id: msg.document.file_id, name: msg.document.file_name ?? "file", mime: msg.document.mime_type ?? "" };
  if (msg.photo?.length) return { file_id: msg.photo[msg.photo.length - 1].file_id, name: "photo.jpg", mime: "image/jpeg" };
  if (msg.video) return { file_id: msg.video.file_id, name: "video.mp4", mime: msg.video.mime_type ?? "video/mp4" };
  if (msg.video_note) return { file_id: msg.video_note.file_id, name: "video_note.mp4", mime: "video/mp4" };
  if (msg.voice) return { file_id: msg.voice.file_id, name: "voice.ogg", mime: msg.voice.mime_type ?? "audio/ogg" };
  if (msg.audio) return { file_id: msg.audio.file_id, name: msg.audio.file_name ?? "audio", mime: msg.audio.mime_type ?? "" };
  if (msg.animation) return { file_id: msg.animation.file_id, name: msg.animation.file_name ?? "animation.mp4", mime: msg.animation.mime_type ?? "" };
  return undefined;
}

/** Хеш развёрнутого коммита — чтобы по /health было видно, какая версия работает. */
function gitCommit(): string | null {
  try {
    const head = readFileSync(".git/HEAD", "utf8").trim();
    if (!head.startsWith("ref:")) return head.slice(0, 7);
    return readFileSync(join(".git", head.slice(5).trim()), "utf8").trim().slice(0, 7);
  } catch {
    return null;
  }
}
const VERSION = gitCommit();

const DOC_TYPE_RU: Record<string, string> = {
  demand: "Отгрузка",
  retaildemand: "Розничная продажа",
  supply: "Приёмка",
  retireorder: "Вывод из оборота",
  loss: "Списание",
  enter: "Оприходование",
  salesreturn: "Возврат покупателя",
  retailsalesreturn: "Возврат розничной продажи",
  customerorder: "Заказ покупателя",
  emissionorder: "Заказ кодов маркировки",
};

export function docTypeRu(t: string): string {
  return DOC_TYPE_RU[t] ?? t;
}

/** Ссылка на документ в интерфейсе МойСклад. */
export function msUiUrl(docType: string, docId: string): string {
  return `https://online.moysklad.ru/app/#${docType}/edit?id=${docId}`;
}

interface CheckRecord {
  at: string;
  docType: string;
  docId: string;
  docName: string;
  storeName?: string;
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
  void resolveChatMigration(cfg); // группа могла стать супергруппой — узнаём актуальный chat_id
  const notifier = makeNotifier(cfg);
  const signQueue = new SignQueue();
  loadRecent();

  // Карта складов id → имя (для алертов); обновляется раз в час.
  const storeNames = new Map<string, string>();
  async function refreshStores(): Promise<void> {
    if (!ms) return;
    try {
      for (const s of await ms.stores()) storeNames.set(s.id ?? idFromHref(s.meta.href), s.name ?? "");
    } catch {
      // не критично — алерт уйдёт без имени склада
    }
  }
  void refreshStores();
  setInterval(refreshStores, 3600_000).unref();

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
          // Маркировка РФ касается только COSMEX Россия — документы
          // казахстанских юрлиц пропускаем молча.
          const orgHref = (doc.organization as { meta?: { href?: string } } | undefined)?.meta?.href;
          if (cfg.moysklad.orgId && orgHref && !orgHref.includes(cfg.moysklad.orgId)) {
            continue;
          }
          const findings = checkDocument(view);
          const storeHref = (doc.store as { meta?: { href?: string } } | undefined)?.meta?.href;
          const storeName = storeHref ? storeNames.get(idFromHref(storeHref)) : undefined;
          const record: CheckRecord = {
            at: new Date().toISOString(),
            docType,
            docId,
            docName: doc.name ?? docId,
            storeName,
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
              [
                `🔴 Маркировка: ${docTypeRu(docType)} № ${record.docName}`,
                record.storeName ? `Склад: ${record.storeName}` : null,
                `Открыть: ${msUiUrl(docType, docId)}`,
                ``,
                top,
              ]
                .filter((x) => x !== null)
                .join("\n"),
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
      // ---------- Telegram: приём сообщений группы (бот — админ группы) ----------
      // Вебхук: POST /webhook/telegram (подлинность — по секретному заголовку Telegram).
      if (req.method === "POST" && url.pathname === "/webhook/telegram") {
        const tgSecret = req.headers["x-telegram-bot-api-secret-token"];
        if (!cfg.server.webhookSecret || tgSecret !== cfg.server.webhookSecret) {
          res.writeHead(403).end();
          return;
        }
        const body = await readBody(req);
        res.writeHead(200).end();
        try {
          const upd = JSON.parse(body) as {
            update_id: number;
            message?: TgMessage;
            edited_message?: TgMessage;
          };
          const msg = upd.message ?? upd.edited_message;
          const groupId = currentChatId(cfg);
          if (msg && groupId && String(msg.chat?.id) === String(groupId)) {
            const rec = {
              update_id: upd.update_id,
              message_id: msg.message_id,
              date: msg.date,
              from: `${msg.from?.first_name ?? ""} ${msg.from?.last_name ?? ""}`.trim() || msg.from?.username || "?",
              text: msg.text ?? msg.caption ?? (msg.sticker ? `(стикер ${msg.sticker.emoji ?? ""})` : ""),
              file: tgAttachment(msg),
              reply_to: msg.reply_to_message?.message_id,
            };
            mkdirSync(DATA_DIR, { recursive: true });
            appendFileSync(join(DATA_DIR, "tg-inbox.jsonl"), JSON.stringify(rec) + "\n");
          }
        } catch {
          console.error("Telegram-вебхук: невалидный JSON");
        }
        return;
      }

      // Чтение входящих: GET /webhook/telegram/{секрет}/inbox?after=<update_id>
      if (req.method === "GET" && url.pathname === `/webhook/telegram/${cfg.server.webhookSecret}/inbox` && cfg.server.webhookSecret) {
        const after = Number(url.searchParams.get("after") ?? 0);
        let rows: unknown[] = [];
        try {
          rows = readFileSync(join(DATA_DIR, "tg-inbox.jsonl"), "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l) as { update_id: number })
            .filter((r) => r.update_id > after)
            .slice(-300);
        } catch {
          rows = [];
        }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ rows }));
        return;
      }

      // Скачивание вложения Telegram по file_id: GET /webhook/telegram/{секрет}/file?file_id=...
      // Токен бота читается на сервере (из .env) и наружу не отдаётся; доступ закрыт секретом вебхука.
      if (req.method === "GET" && url.pathname === `/webhook/telegram/${cfg.server.webhookSecret}/file` && cfg.server.webhookSecret) {
        const fileId = url.searchParams.get("file_id");
        const token = cfg.telegram.botToken;
        if (!fileId || !token) {
          res.writeHead(400).end("нужны file_id и токен бота");
          return;
        }
        try {
          const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
          const meta = (await metaRes.json()) as { ok: boolean; result?: { file_path?: string } };
          const filePath = meta.result?.file_path;
          if (!meta.ok || !filePath) {
            res.writeHead(404).end("файл не найден в Telegram");
            return;
          }
          const binRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
          if (!binRes.ok) {
            res.writeHead(502).end("не удалось скачать файл из Telegram");
            return;
          }
          const buf = Buffer.from(await binRes.arrayBuffer());
          const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
          const ct =
            ext === "jpg" || ext === "jpeg" ? "image/jpeg"
            : ext === "png" ? "image/png"
            : ext === "pdf" ? "application/pdf"
            : ext === "mp4" ? "video/mp4"
            : ext === "ogg" || ext === "oga" ? "audio/ogg"
            : "application/octet-stream";
          res.writeHead(200, { "Content-Type": ct }).end(buf);
        } catch {
          res.writeHead(502).end("ошибка загрузки файла");
        }
        return;
      }

      // Вебхуки МойСклад: /webhook/{секрет}/{entityType}/{action}
      // (секрет также принимается query-параметром для обратной совместимости).
      if (req.method === "POST" && url.pathname.startsWith("/webhook")) {
        const segments = url.pathname.split("/").filter(Boolean); // ["webhook", секрет?, ...]
        const secretOk =
          !cfg.server.webhookSecret ||
          segments[1] === cfg.server.webhookSecret ||
          url.searchParams.get("secret") === cfg.server.webhookSecret;
        if (!secretOk) {
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

      // ---------- Очередь подписи УКЭП (офисный агент) ----------
      if (url.pathname.startsWith("/sign/")) {
        const secret = req.headers["x-signer-secret"];
        if (!cfg.server.signerSecret || secret !== cfg.server.signerSecret) {
          res.writeHead(403).end();
          return;
        }
        if (req.method === "POST" && url.pathname === "/sign/request") {
          const { data } = JSON.parse(await readBody(req)) as { data: string };
          try {
            const signature = await signQueue.request(data);
            res
              .writeHead(200, { "Content-Type": "application/json" })
              .end(JSON.stringify({ signature }));
          } catch (err) {
            res
              .writeHead(504, { "Content-Type": "application/json; charset=utf-8" })
              .end(JSON.stringify({ error: (err as Error).message }));
          }
          return;
        }
        if (req.method === "GET" && url.pathname === "/sign/poll") {
          // Long-poll до 25 секунд, чтобы агент не молотил запросами.
          const deadline = Date.now() + 25_000;
          let jobs = signQueue.take();
          while (jobs.length === 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 1000));
            jobs = signQueue.take();
          }
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ jobs: jobs.map((j) => ({ id: j.id, data: j.data })) }));
          return;
        }
        if (req.method === "POST" && url.pathname === "/sign/result") {
          const body = JSON.parse(await readBody(req)) as {
            id: string;
            signature?: string;
            error?: string;
          };
          const ok = signQueue.complete(body.id, body.signature ?? null, body.error);
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok }));
          return;
        }
        res.writeHead(404).end();
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
          .end(
            JSON.stringify({
              ok: true,
              version: VERSION,
              moysklad: Boolean(ms),
              checks: recent.length,
              signQueue: signQueue.pending(),
            }),
          );
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
        <td>${docTypeRu(r.docType)}</td>
        <td><a href="${msUiUrl(r.docType, r.docId)}" target="_blank">${r.docName}</a></td>
        <td>${r.storeName ?? ""}</td>
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
<table><tr><th></th><th>Когда</th><th>Документ</th><th>Номер</th><th>Склад</th><th>Находки</th></tr>
${rows || "<tr><td colspan=6>Проверок ещё не было. Настройте вебхуки: node src/cli.ts setup-webhooks &lt;публичный URL&gt;</td></tr>"}
</table></body></html>`;
}

if (import.meta.url === `file://${process.argv[1]}`) startServer();
