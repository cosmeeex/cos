/**
 * Контроль вывода из оборота при дистанционной продаже.
 *
 * Правило ЧЗ: при продаже интернет-магазином с доставкой вывод из оборота
 * подаётся при отгрузке со склада, не позднее 3 рабочих дней с отгрузки
 * и не позднее дня вручения покупателю (причина — «дистанционный способ продажи»).
 *
 * Монитор находит отгрузки (demand) с маркированными позициями, для которых
 * не создан «Вывод из оборота», и считает оставшийся срок. Связь установлена
 * по соглашению: retireorder.description содержит имя отгрузки.
 */

export interface DemandSummary {
  id: string;
  name: string;
  moment: Date;
  /** Есть ли в отгрузке маркированные позиции с кодами. */
  trackedCodesCount: number;
  /** Продажа конечному покупателю (розница/интернет), а не опт по УПД. */
  isRetailShipment: boolean;
}

export interface RetireOrderSummary {
  id: string;
  name: string;
  description?: string | null;
  retireOrderType?: string;
  documentState?: string;
}

export type DistanceStatus = "ok" | "pending" | "overdue" | "failed";

export interface DistanceFinding {
  demand: DemandSummary;
  status: DistanceStatus;
  deadline: Date;
  hoursLeft: number;
  message: string;
}

/** Прибавляет N рабочих дней (суббота/воскресенье пропускаются). */
export function addWorkdays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

export function checkDistanceRetirement(
  demands: DemandSummary[],
  retireOrders: RetireOrderSummary[],
  now = new Date(),
): DistanceFinding[] {
  const findings: DistanceFinding[] = [];

  for (const demand of demands) {
    if (!demand.isRetailShipment || demand.trackedCodesCount === 0) continue;
    const linked = retireOrders.filter(
      (r) => (r.description ?? "").includes(demand.name) || r.name === demand.name,
    );
    const deadline = addWorkdays(demand.moment, 3);
    const hoursLeft = Math.round((deadline.getTime() - now.getTime()) / 3600_000);

    const failed = linked.find((r) => r.documentState === "CHECKED_NOT_OK" || r.documentState === "PROCESSING_ERROR");
    const done = linked.find((r) => r.documentState === "CHECKED_OK" || r.documentState === "SEND" || r.documentState === "IN_PROGRESS");

    if (failed && !done) {
      findings.push({
        demand,
        status: "failed",
        deadline,
        hoursLeft,
        message: `Вывод из оборота по «${demand.name}» отклонён ГИС МТ (${failed.name}) — исправить и отправить заново`,
      });
    } else if (!done && linked.length === 0) {
      findings.push({
        demand,
        status: hoursLeft < 0 ? "overdue" : "pending",
        deadline,
        hoursLeft,
        message:
          hoursLeft < 0
            ? `ПРОСРОЧЕНО: по отгрузке «${demand.name}» (${demand.trackedCodesCount} КМ) не подан вывод из оборота — срок истёк ${deadline.toISOString().slice(0, 10)}. Подать немедленно, риск штрафа по ст. 15.12.1 КоАП`
            : `По отгрузке «${demand.name}» (${demand.trackedCodesCount} КМ) ещё не подан вывод из оборота — осталось ~${hoursLeft} ч (до ${deadline.toISOString().slice(0, 10)})`,
      });
    }
  }

  const rank: Record<DistanceStatus, number> = { failed: 0, overdue: 1, pending: 2, ok: 3 };
  findings.sort((a, b) => rank[a.status] - rank[b.status] || a.hoursLeft - b.hoursLeft);
  return findings;
}
