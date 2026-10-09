import { answer, createBook, metricsOf, stepHour, topAlert } from "./engine";
import { MARKET } from "./market";
import type { Book } from "./types";

function auto(start: Book): Book {
  let s = start;
  const end = MARKET.openAt + 120 * 24 * 3_600_000;
  for (let i = 0; i < 8000; i++) {
    const alert = topAlert(s.alerts);
    if (alert) {
      if (alert.kind === "GATE") s = answer(s, alert.id, "TAKEN");
      else if (alert.kind === "EXIT") s = answer(s, alert.id, "CLOSED");
      else s = answer(s, alert.id, "HOLD");
      continue;
    }
    if (s.now > end) break;
    const n = stepHour(s);
    if (n.now === s.now) break;
    s = n;
  }
  return s;
}

const open = createBook();
console.log(
  JSON.stringify(
    {
      openAt: new Date(open.now).toISOString(),
      watch: open.watchlist.map((w) => ({ c: w.coin, imp: +w.impulsePct.toFixed(3) })),
      zones: open.zones.map((z) => ({ c: z.coin, top: +z.zoneTop.toFixed(2), bot: +z.zoneBottom.toFixed(2), s: z.status })),
      marks: MARKET.marks.length,
    },
    null,
    2,
  ),
);

let stepped = stepHour(open);
const first = topAlert(stepped.alerts);
console.log("first alert", first?.kind, first && stepped.plans.find((p) => p.id === (first.kind === "GATE" ? first.planId : "")));

const done = auto(open);
const m = metricsOf(done);
const skipped = done.journal.filter((j) => j.kind === "SKIPPED");
const rej = done.rejections.map((r) => `${r.coin} ${r.reason}`);
const rules = done.positions
  .filter((p) => p.status === "CLOSED" && p.netPnl !== undefined)
  .reduce<Record<string, number>>((acc, p) => {
    const k = p.exitRule ?? "?";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
console.log(
  JSON.stringify(
    {
      trades: m.trades,
      wins: m.wins,
      winRate: +m.winRate.toFixed(3),
      expectancy: +m.expectancy.toFixed(3),
      maxDd: +m.maxDd.toFixed(3),
      pass: m.pass,
      plans: done.plans.length,
      rejections: rej,
      skipped: skipped.length,
      rules,
      reports: done.reports.length,
      lastNow: new Date(done.now).toISOString(),
      openLeft: done.positions.filter((p) => p.status === "OPEN").length,
      shadows: done.positions.filter((p) => p.status === "SHADOW").length,
    },
    null,
    2,
  ),
);
