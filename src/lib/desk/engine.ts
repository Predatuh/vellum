import { fmtR, fmtUsd } from "./format";
import { closedH1, COINS, DAY, H4, HOUR, MARKET, resample } from "./market";
import { candleTape } from "./tape";
import { RULES } from "./rules";
import type {
  Alert,
  Book,
  Candle,
  Checks,
  JournalLine,
  Metrics,
  Plan,
  Position,
  SundayReport,
  SymbolId,
  WatchRow,
  Zone,
} from "./types";

const bps = (n: number, rate: number) => Math.abs(n) * (rate / 10_000);

function empty(now: number): Book {
  return {
    now,
    balance: RULES.startingBalance,
    realBalance: null,
    watchlist: [],
    zones: [],
    plans: [],
    rejections: [],
    decisions: [],
    positions: [],
    journal: [],
    alerts: [],
    reports: [],
    tape: [],
    lastScreenAt: null,
    lastMapAt: null,
  };
}

function note(book: Book, seat: string, text: string): Book {
  return {
    ...book,
    tape: [...book.tape, { at: book.now, seat, text }].slice(-100),
  };
}

export function h4(coin: SymbolId, now: number): Candle[] {
  return resample(candleTape()[coin] ?? [], H4, now);
}

export function h1(coin: SymbolId, now: number): Candle[] {
  return closedH1(candleTape()[coin] ?? [], now);
}

function impulse(coin: SymbolId, now: number): WatchRow | null {
  const bars = h4(coin, now);
  const windowStart = now - RULES.anchorDays * DAY;
  const window = bars.filter((b) => b.t + H4 >= windowStart);
  if (window.length < 6) return null;
  let anchor = window[0]!;
  for (const b of window) if (b.h > anchor.h) anchor = b;
  const since = bars.filter((b) => b.t >= anchor.t);
  if (!since.length) return null;
  let lowBar = since[0]!;
  for (const b of since) if (b.l < lowBar.l) lowBar = b;
  const impulsePct = (anchor.h - lowBar.l) / anchor.h;
  if (impulsePct < RULES.impulseMin) return null;
  const age = now - lowBar.t;
  if (age > RULES.lowFreshDays * DAY) return null;
  return {
    coin,
    anchorHigh: anchor.h,
    anchorTime: anchor.t,
    currentLow: lowBar.l,
    impulsePct,
  };
}

function screen(book: Book, why: string): Book {
  const rows: WatchRow[] = [];
  for (const coin of COINS) {
    const row = impulse(coin, book.now);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => b.impulsePct - a.impulsePct);
  const changed =
    rows.map((r) => r.coin).join() !== book.watchlist.map((r) => r.coin).join();
  let next: Book = { ...book, watchlist: rows, lastScreenAt: book.now };
  if (changed) {
    const names = rows.map((r) => r.coin).join(", ") || "empty";
    next = note(next, "Screener", `${why} · watchlist ${names}`);
  }
  return next;
}

function mapCoin(row: WatchRow, now: number): Zone[] {
  const bars = h4(row.coin, now);
  const zones: Zone[] = [];
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2]!;
    const mid = bars[i - 1]!;
    const c = bars[i]!;
    if (c.t < row.anchorTime) continue;
    if (!(c.h < a.l)) continue;
    if (!(mid.o >= a.l * 0.999 && c.o < a.l)) continue;
    const zoneTop = a.l;
    const zoneBottom = c.h;
    if (zoneTop <= zoneBottom) continue;
    if ((zoneTop - zoneBottom) / zoneBottom < RULES.minGap) continue;
    if (zoneBottom <= row.currentLow) continue;
    if (zoneTop > row.anchorHigh * 1.002) continue;
    const formedAt = c.t;
    const done = formedAt + H4;
    const hours = h1(row.coin, now).filter((x) => x.t + HOUR > done && x.t + HOUR <= now);
    let mitigated = false;
    let tested = false;
    let confirmed = false;
    for (const x of hours) {
      if (mitigated) break;
      if (x.c > zoneTop) {
        mitigated = true;
        break;
      }
      const hit = x.h >= zoneBottom && x.l <= zoneTop;
      if (!hit) continue;
      tested = true;
      if (x.c < zoneBottom && x.c < x.o) confirmed = true;
    }
    zones.push({
      id: `${row.coin}-${formedAt}`,
      coin: row.coin,
      zoneTop,
      zoneBottom,
      formedAt,
      status: mitigated ? "MITIGATED" : tested ? "TESTED" : "OPEN",
      confirmed: confirmed && !mitigated,
    });
  }
  zones.sort((a, b) => b.zoneTop - a.zoneTop);
  return zones;
}

function firstConfirmClose(zone: Zone, now: number): number | null {
  const hours = h1(zone.coin, now).filter((x) => x.t + HOUR > zone.formedAt + H4);
  for (const x of hours) {
    if (x.c > zone.zoneTop) return null;
    const hit = x.h >= zone.zoneBottom && x.l <= zone.zoneTop;
    if (hit && x.c < zone.zoneBottom && x.c < x.o) return x.t + HOUR;
  }
  return null;
}

function mapZones(book: Book, why: string): Book {
  const zones: Zone[] = [];
  for (const row of book.watchlist) zones.push(...mapCoin(row, book.now));
  const prev = new Set(book.zones.filter((z) => z.confirmed).map((z) => z.id));
  const fresh = zones.filter((z) => z.confirmed && !prev.has(z.id));
  let next: Book = { ...book, zones, lastMapAt: book.now };
  for (const z of fresh) {
    next = note(
      next,
      "Cartographer",
      `${z.coin} confirmed · ${z.zoneTop.toFixed(2)} – ${z.zoneBottom.toFixed(2)}`,
    );
  }
  if (why === "desk open") {
    next = note(next, "Cartographer", `${zones.length} zones on the ladder`);
  }
  return next;
}

type Walk = {
  stop: number;
  breakeven: boolean;
  exit: { rule: string; price: number; at: number } | null;
};

function walk(pos: Position, now: number): Walk {
  const risk = pos.initialStop - pos.entry;
  const target = pos.entry - RULES.targetR * risk;
  const beLevel = pos.entry - RULES.beR * risk;
  let stop = pos.initialStop;
  let breakeven = false;
  for (const c of h1(pos.coin, now)) {
    if (c.t + HOUR <= pos.openedAt) continue;
    const hitStop = c.h >= stop;
    const hitTarget = c.l <= target;
    if (hitStop) {
      return {
        stop,
        breakeven,
        exit: {
          rule: breakeven ? "STOP — at breakeven" : "HARD STOP",
          price: stop,
          at: c.t + HOUR,
        },
      };
    }
    if (hitTarget) {
      return { stop, breakeven, exit: { rule: "TARGET 2R", price: target, at: c.t + HOUR } };
    }
    if (!breakeven && c.l <= beLevel) {
      breakeven = true;
      stop = pos.entry;
    }
  }
  return { stop, breakeven, exit: null };
}

function opposing(pos: Position, now: number): { price: number; at: number } | null {
  const bars = h4(pos.coin, now);
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2]!;
    const c = bars[i]!;
    if (c.t < pos.openedAt) continue;
    const at = c.t + H4;
    if (at > now) break;
    if (c.l > a.h && c.l > pos.entry && c.c > pos.entry) {
      return { price: c.c, at };
    }
  }
  return null;
}

function refreshBreakeven(book: Book): Book {
  let changed = false;
  const positions = book.positions.map((pos) => {
    if (pos.status !== "OPEN" && pos.status !== "SHADOW") return pos;
    const w = walk(pos, book.now);
    if (w.exit) return pos;
    if (w.breakeven === pos.breakeven && w.stop === pos.stop) return pos;
    changed = true;
    return { ...pos, breakeven: w.breakeven, stop: w.stop };
  });
  if (!changed) return book;
  let next: Book = { ...book, positions };
  for (const pos of positions) {
    const prev = book.positions.find((p) => p.planId === pos.planId);
    if (prev && !prev.breakeven && pos.breakeven && pos.status === "OPEN") {
      next = note(next, "Exit Clerk", `${pos.coin} stop moved to entry · breakeven`);
    }
  }
  return next;
}

function previousOpen(book: Book, coin: SymbolId): Position | undefined {
  const open = book.positions.filter((p) => p.coin === coin && p.status === "OPEN");
  return open[open.length - 1];
}

function risk(book: Book): Book {
  let next = book;
  for (const zone of book.zones) {
    if (!zone.confirmed) continue;
    if (next.plans.some((p) => p.zoneId === zone.id)) continue;
    if (next.rejections.some((r) => r.zoneId === zone.id)) continue;
    const confirmedAt = firstConfirmClose(zone, next.now);
    if (confirmedAt !== next.now) continue;
    const dist = zone.zoneTop - zone.zoneBottom;
    if (!(dist > 0) || !(next.balance > 0)) {
      next = {
        ...next,
        rejections: [
          ...next.rejections,
          {
            id: `rej-${zone.id}`,
            at: next.now,
            coin: zone.coin,
            zoneId: zone.id,
            zoneTop: zone.zoneTop,
            zoneBottom: zone.zoneBottom,
            reason: "degenerate zone",
          },
        ],
      };
      next = note(next, "Risk", `${zone.coin} rejected · degenerate zone`);
      continue;
    }
    const prev = previousOpen(next, zone.coin);
    if (prev && !prev.breakeven) {
      next = {
        ...next,
        rejections: [
          ...next.rejections,
          {
            id: `rej-${zone.id}`,
            at: next.now,
            coin: zone.coin,
            zoneId: zone.id,
            zoneTop: zone.zoneTop,
            zoneBottom: zone.zoneBottom,
            reason: "previous entry not at breakeven",
          },
        ],
      };
      next = note(next, "Risk", `${zone.coin} rejected · previous entry not at breakeven`);
      continue;
    }
    const riskUsd = next.balance * RULES.riskPct;
    const plan: Plan = {
      id: zone.id,
      at: next.now,
      coin: zone.coin,
      zoneId: zone.id,
      zoneTop: zone.zoneTop,
      zoneBottom: zone.zoneBottom,
      entry: zone.zoneBottom,
      stop: zone.zoneTop,
      size: riskUsd / dist,
      riskPct: RULES.riskPct,
      riskUsd,
      addNumber: prev ? prev.addNumber + 1 : 1,
    };
    next = { ...next, plans: [...next.plans, plan] };
    next = note(
      next,
      "Risk",
      `${plan.coin} plan · add ${plan.addNumber} · size ${plan.size.toFixed(4)}`,
    );
  }
  return next;
}

function gate(book: Book): Book {
  const alerts = [...book.alerts];
  let next = book;
  for (const plan of book.plans) {
    if (book.decisions.some((d) => d.planId === plan.id)) continue;
    if (alerts.some((a) => a.kind === "GATE" && a.planId === plan.id)) continue;
    alerts.push({ id: `gate-${plan.id}`, kind: "GATE", planId: plan.id, at: book.now });
    next = note(next, "Gate", `${plan.coin} slip sent · waiting`);
  }
  return { ...next, alerts };
}

function isFlat(pos: Position, now: number): boolean {
  if (now - pos.openedAt < RULES.staleHours * HOUR) return false;
  const from = now - RULES.staleHours * HOUR;
  let maxH = -Infinity;
  let minL = Infinity;
  let n = 0;
  for (const c of h1(pos.coin, now)) {
    const closeAt = c.t + HOUR;
    if (closeAt <= Math.max(pos.openedAt, from) || closeAt > now) continue;
    maxH = Math.max(maxH, c.h);
    minL = Math.min(minL, c.l);
    n += 1;
  }
  if (n < 24) return false;
  const riskDist = pos.initialStop - pos.entry;
  if (!(riskDist > 0)) return false;
  const mfe = (pos.entry - minL) / riskDist;
  const mae = (maxH - pos.entry) / riskDist;
  return mfe < RULES.staleBandR && mae < RULES.staleBandR;
}

function pnl(pos: Position, exitPrice: number): { net: number; r: number; feeIn: number; feeOut: number; slipIn: number; slipOut: number } {
  const feeIn = bps(pos.size * pos.entry, RULES.feeBps);
  const feeOut = bps(pos.size * exitPrice, RULES.feeBps);
  const slipIn = bps(pos.size * pos.entry, RULES.slipBps);
  const slipOut = bps(pos.size * exitPrice, RULES.slipBps);
  const gross = pos.size * (pos.entry - exitPrice);
  const net = gross - feeIn - feeOut - slipIn - slipOut;
  return { net, r: net / pos.riskUsd, feeIn, feeOut, slipIn, slipOut };
}

function withClose(
  book: Book,
  pos: Position,
  exitPrice: number,
  rule: string,
  at: number,
  shadow: boolean,
): Book {
  const money = pnl(pos, exitPrice);
  const positions = book.positions.map((p) =>
    p.planId === pos.planId
      ? {
          ...p,
          status: "CLOSED" as const,
          exitAt: at,
          exitPrice,
          exitRule: rule,
          netPnl: shadow ? undefined : money.net,
          netR: money.r,
        }
      : p,
  );
  const journal: JournalLine[] = [...book.journal];
  if (shadow) {
    journal.push({
      id: `${pos.planId}:skipped`,
      at,
      coin: pos.coin,
      planId: pos.planId,
      kind: "SKIPPED",
      text: `${pos.coin} skipped — would have returned ${fmtR(money.r)} via ${rule}`,
      r: money.r,
    });
  } else {
    journal.push(
      {
        id: `${pos.planId}:exit`,
        at,
        coin: pos.coin,
        planId: pos.planId,
        kind: "EXIT",
        text: `${pos.coin} exit ${exitPrice} · ${rule}`,
      },
      {
        id: `${pos.planId}:fee-out`,
        at,
        coin: pos.coin,
        planId: pos.planId,
        kind: "FEE",
        text: `${pos.coin} exit fee ${RULES.feeBps} bps ${fmtUsd(money.feeOut)}`,
      },
      {
        id: `${pos.planId}:slip-out`,
        at,
        coin: pos.coin,
        planId: pos.planId,
        kind: "SLIPPAGE",
        text: `${pos.coin} exit slippage ${RULES.slipBps} bps ${fmtUsd(money.slipOut)}`,
      },
      {
        id: `${pos.planId}:result`,
        at,
        coin: pos.coin,
        planId: pos.planId,
        kind: "RESULT",
        text: `${pos.coin} result ${fmtR(money.r)}`,
        r: money.r,
      },
    );
  }
  return {
    ...book,
    positions,
    journal,
    balance: shadow ? book.balance : book.balance + money.net,
  };
}

function exitClerk(book: Book): Book {
  let next = book;
  for (const pos of book.positions) {
    if (pos.status !== "OPEN" && pos.status !== "SHADOW") continue;
    if (next.alerts.some((a) => a.planId === pos.planId)) continue;
    const w = walk(pos, next.now);
    const against = w.exit ? null : opposing(pos, next.now);
    const event = w.exit ?? (against ? { rule: "BULLISH 4H FVG AGAINST THE SHORT", price: against.price, at: against.at } : null);
    if (event) {
      if (pos.status === "SHADOW") {
        next = withClose(next, pos, event.price, event.rule, next.now, true);
        next = note(next, "Auditor", `${pos.coin} skipped resolved · ${event.rule}`);
      } else {
        const alert: Alert = {
          id: `exit-${pos.planId}`,
          kind: "EXIT",
          planId: pos.planId,
          rule: event.rule,
          exitPrice: event.price,
          at: next.now,
        };
        next = { ...next, alerts: [...next.alerts, alert] };
        next = note(next, "Exit Clerk", `EXIT NOW · ${pos.coin} · ${event.rule}`);
      }
      continue;
    }
    if (pos.status !== "OPEN") continue;
    if (pos.staleHoldUntil && next.now < pos.staleHoldUntil) continue;
    if (!isFlat(pos, next.now)) continue;
    next = {
      ...next,
      alerts: [...next.alerts, { id: `stale-${pos.planId}-${next.now}`, kind: "STALE", planId: pos.planId, at: next.now }],
    };
    next = note(next, "Exit Clerk", `STALE · ${pos.coin} · flat ${RULES.staleHours}h`);
  }
  return next;
}

export function metricsOf(book: Book): Metrics {
  const closed = book.positions
    .filter((p) => p.status === "CLOSED" && p.netPnl !== undefined && p.netR !== undefined && p.exitAt)
    .sort((a, b) => a.exitAt! - b.exitAt!);
  let equity: number = RULES.startingBalance;
  let peak = equity;
  let maxDd = 0;
  const curve = [equity];
  let wins = 0;
  let sum = 0;
  for (const p of closed) {
    equity += p.netPnl!;
    sum += p.netR!;
    if (p.netR! > 0) wins += 1;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - equity) / peak);
    curve.push(equity);
  }
  const trades = closed.length;
  const winRate = trades ? wins / trades : 0;
  const expectancy = trades ? sum / trades : 0;
  const checks: Checks = {
    trades: trades >= RULES.thresholds.trades,
    winRate: trades > 0 && winRate >= RULES.thresholds.winRate,
    expectancy: trades > 0 && expectancy >= RULES.thresholds.expectancy,
    maxDd: maxDd <= RULES.thresholds.maxDd,
  };
  return {
    trades,
    wins,
    winRate,
    expectancy,
    maxDd,
    equity: curve,
    checks,
    pass: checks.trades && checks.winRate && checks.expectancy && checks.maxDd,
  };
}

function sunday(book: Book): Book {
  if (book.reports.some((r) => r.at === book.now)) return book;
  const m = metricsOf(book);
  const report: SundayReport = {
    at: book.now,
    trades: m.trades,
    wins: m.wins,
    winRate: m.winRate,
    expectancy: m.expectancy,
    maxDd: m.maxDd,
    pass: m.pass,
    checks: m.checks,
  };
  return note(
    { ...book, reports: [...book.reports, report] },
    "Auditor",
    report.pass ? "Sunday report · GO" : "Sunday report · NO-GO",
  );
}

function atClose(book: Book, why: string): Book {
  const hr = new Date(book.now).getUTCHours();
  const isDaily = hr === 0;
  const is4h = hr % 4 === 0;
  let next = book;
  if (isDaily) next = screen(next, why);
  next = mapZones(next, why);
  next = refreshBreakeven(next);
  next = risk(next);
  next = gate(next);
  if (is4h) next = exitClerk(next);
  if (isDaily && new Date(book.now).getUTCDay() === 0) next = sunday(next);
  return next;
}

export function blankBook(): Book {
  return empty(0);
}

export function createBook(): Book {
  let book = empty(MARKET.openAt);
  book = screen(book, "desk open");
  book = mapZones(book, "desk open");
  return book;
}

export function openLive(now: number): Book {
  return atClose(screen(empty(now), "desk open"), "hour close");
}

export function catchUp(book: Book, target: number): Book {
  let next = book;
  for (let guard = 0; guard < 72 && next.alerts.length === 0 && next.now + HOUR <= target; guard++) {
    const stepped = stepHour(next);
    if (stepped.now === next.now) break;
    next = stepped;
  }
  return next;
}

export function runAuto(book: Book, target: number): Book {
  const aligned = book.now > 0 && target >= book.now && target - book.now <= 72 * HOUR;
  let next = aligned ? book : openLive(target);
  for (let guard = 0; guard < 240; guard++) {
    const alert = topAlert(next.alerts);
    if (alert) {
      const choice = alert.kind === "GATE" ? "TAKEN" : alert.kind === "EXIT" ? "CLOSED" : "HOLD";
      next = answer(next, alert.id, choice);
      continue;
    }
    if (next.now + HOUR > target) return next;
    const stepped = stepHour(next);
    if (stepped.now === next.now) return next;
    next = stepped;
  }
  return next;
}

export function stepHour(book: Book): Book {
  if (book.alerts.length > 0) return book;
  const now = book.now + HOUR;
  const hr = new Date(now).getUTCHours();
  const why = hr === 0 ? "daily close" : hr % 4 === 0 ? "4H close" : "1H close";
  return atClose({ ...book, now }, why);
}

export function answer(book: Book, alertId: string, choice: "TAKEN" | "SKIPPED" | "CLOSED" | "HOLD"): Book {
  const alert = book.alerts.find((a) => a.id === alertId);
  if (!alert) return book;
  if (alert.kind === "GATE" && choice !== "TAKEN" && choice !== "SKIPPED") return book;
  if (alert.kind === "EXIT" && choice !== "CLOSED") return book;
  if (alert.kind === "STALE" && choice !== "HOLD" && choice !== "CLOSED") return book;
  const rest = book.alerts.filter((a) => a.id !== alertId);
  let next: Book = { ...book, alerts: rest };

  if (alert.kind === "GATE") {
    const plan = next.plans.find((p) => p.id === alert.planId);
    if (!plan) return next;
    next = {
      ...next,
      decisions: [...next.decisions, { planId: plan.id, at: next.now, decision: choice === "SKIPPED" ? "SKIPPED" : "TAKEN" }],
    };
    if (choice === "SKIPPED") {
      const pos: Position = {
        planId: plan.id,
        coin: plan.coin,
        entry: plan.entry,
        initialStop: plan.stop,
        stop: plan.stop,
        size: plan.size,
        riskUsd: plan.riskUsd,
        addNumber: plan.addNumber,
        openedAt: next.now,
        zoneTop: plan.zoneTop,
        zoneBottom: plan.zoneBottom,
        breakeven: false,
        status: "SHADOW",
        staleHoldUntil: null,
      };
      next = { ...next, positions: [...next.positions, pos] };
      return note(next, "Gate", `${plan.coin} SKIPPED`);
    }
    const pos: Position = {
      planId: plan.id,
      coin: plan.coin,
      entry: plan.entry,
      initialStop: plan.stop,
      stop: plan.stop,
      size: plan.size,
      riskUsd: plan.riskUsd,
      addNumber: plan.addNumber,
      openedAt: next.now,
      zoneTop: plan.zoneTop,
      zoneBottom: plan.zoneBottom,
      breakeven: false,
      status: "OPEN",
      staleHoldUntil: null,
    };
    const feeIn = bps(pos.size * pos.entry, RULES.feeBps);
    const slipIn = bps(pos.size * pos.entry, RULES.slipBps);
    const lines: JournalLine[] = [
      {
        id: `${pos.planId}:entry`,
        at: next.now,
        coin: pos.coin,
        planId: pos.planId,
        kind: "ENTRY",
        text: `${pos.coin} entry ${pos.entry} short · add ${pos.addNumber}`,
      },
      {
        id: `${pos.planId}:fee-in`,
        at: next.now,
        coin: pos.coin,
        planId: pos.planId,
        kind: "FEE",
        text: `${pos.coin} entry fee ${RULES.feeBps} bps ${fmtUsd(feeIn)}`,
      },
      {
        id: `${pos.planId}:slip-in`,
        at: next.now,
        coin: pos.coin,
        planId: pos.planId,
        kind: "SLIPPAGE",
        text: `${pos.coin} entry slippage ${RULES.slipBps} bps ${fmtUsd(slipIn)}`,
      },
    ];
    next = { ...next, positions: [...next.positions, pos], journal: [...next.journal, ...lines] };
    return note(next, "Gate", `${plan.coin} TAKEN · add ${plan.addNumber}`);
  }

  const pos = next.positions.find((p) => p.planId === alert.planId && p.status === "OPEN");
  if (!pos) return next;
  if (alert.kind === "STALE" && choice === "HOLD") {
    next = {
      ...next,
      positions: next.positions.map((p) =>
        p.planId === pos.planId ? { ...p, staleHoldUntil: next.now + RULES.staleHours * HOUR } : p,
      ),
    };
    return note(next, "Exit Clerk", `${pos.coin} STALE held`);
  }
  if (choice !== "CLOSED") return { ...book };
  if (alert.kind === "EXIT") {
    next = withClose(next, pos, alert.exitPrice, alert.rule, next.now, false);
    return note(next, "Exit Clerk", `${pos.coin} closed · ${alert.rule}`);
  }
  const mark = markPrice(pos.coin, next.now) ?? pos.entry;
  next = withClose(next, pos, mark, "STALE CLOSE", next.now, false);
  return note(next, "Exit Clerk", `${pos.coin} closed flat · you decided`);
}

export function markPrice(coin: SymbolId, now: number): number | null {
  const bars = h1(coin, now);
  return bars.length ? bars[bars.length - 1]!.c : null;
}

export function topAlert(alerts: Alert[]): Alert | null {
  if (!alerts.length) return null;
  const rank = { EXIT: 0, STALE: 1, GATE: 2 } as const;
  return [...alerts].sort((a, b) => rank[a.kind] - rank[b.kind] || a.at - b.at)[0]!;
}

export function setRealBalance(book: Book, value: number | null): Book {
  return { ...book, realBalance: value };
}

export function liveR(pos: Position, now: number): number | null {
  const mark = markPrice(pos.coin, now);
  if (mark === null) return null;
  const riskDist = pos.initialStop - pos.entry;
  if (!(riskDist > 0)) return null;
  return (pos.entry - mark) / riskDist;
}
