import { test } from "node:test";
import assert from "node:assert/strict";
import { addWorkdays, checkDistanceRetirement, type DemandSummary } from "../src/guard/distance.ts";

const demand = (over: Partial<DemandSummary> = {}): DemandSummary => ({
  id: "d1",
  name: "Отгрузка №00123",
  moment: new Date("2026-08-17T10:00:00Z"), // понедельник
  trackedCodesCount: 3,
  isRetailShipment: true,
  ...over,
});

test("addWorkdays пропускает выходные", () => {
  // Пятница + 3 рабочих дня = среда.
  const d = addWorkdays(new Date("2026-08-14T10:00:00Z"), 3);
  assert.equal(d.toISOString().slice(0, 10), "2026-08-19");
});

test("отгрузка без вывода из оборота в пределах срока — pending", () => {
  const findings = checkDistanceRetirement([demand()], [], new Date("2026-08-18T10:00:00Z"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, "pending");
  assert.match(findings[0].message, /не подан вывод/);
});

test("просрочка 3 рабочих дней — overdue с упоминанием штрафа", () => {
  const findings = checkDistanceRetirement([demand()], [], new Date("2026-08-25T10:00:00Z"));
  assert.equal(findings[0].status, "overdue");
  assert.match(findings[0].message, /15\.12\.1/);
});

test("связанный вывод из оборота со статусом CHECKED_OK закрывает отгрузку", () => {
  const findings = checkDistanceRetirement(
    [demand()],
    [{ id: "r1", name: "Вывод-1", description: "по Отгрузка №00123", documentState: "CHECKED_OK" }],
    new Date("2026-08-25T10:00:00Z"),
  );
  assert.equal(findings.length, 0);
});

test("отклонённый ГИС МТ вывод — failed", () => {
  const findings = checkDistanceRetirement(
    [demand()],
    [{ id: "r1", name: "Вывод-1", description: "по Отгрузка №00123", documentState: "CHECKED_NOT_OK" }],
    new Date("2026-08-18T10:00:00Z"),
  );
  assert.equal(findings[0].status, "failed");
});

test("оптовая отгрузка и отгрузка без КМ не проверяются", () => {
  const findings = checkDistanceRetirement(
    [demand({ isRetailShipment: false }), demand({ id: "d2", name: "О-2", trackedCodesCount: 0 })],
    [],
  );
  assert.equal(findings.length, 0);
});
