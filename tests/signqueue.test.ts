import { test } from "node:test";
import assert from "node:assert/strict";
import { SignQueue } from "../src/crpt/signqueue.ts";

test("полный цикл: request → take → complete", async () => {
  const q = new SignQueue();
  const promise = q.request("данные-на-подпись", 5000);
  const jobs = q.take();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].data, "данные-на-подпись");
  assert.equal(q.complete(jobs[0].id, "ПОДПИСЬ"), true);
  assert.equal(await promise, "ПОДПИСЬ");
  assert.equal(q.pending(), 0);
});

test("ошибка от агента прокидывается вызывающему", async () => {
  const q = new SignQueue();
  const promise = q.request("x", 5000);
  const [job] = q.take();
  q.complete(job.id, null, "сертификат не найден");
  await assert.rejects(promise, /сертификат не найден/);
});

test("таймаут, если агент не забрал задание", async () => {
  const q = new SignQueue();
  await assert.rejects(q.request("x", 50), /подписант не ответил/);
});

test("взятое задание не выдаётся повторно; чужой id не ломает очередь", async () => {
  const q = new SignQueue();
  const p = q.request("x", 5000);
  assert.equal(q.take().length, 1);
  assert.equal(q.take().length, 0);
  assert.equal(q.complete("нет-такого", "sig"), false);
  const [job] = [...(q as unknown as { jobs: Map<string, { id: string }> }).jobs.values()];
  q.complete(job.id, "s");
  await p;
});
