import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  Calculator,
  Inbox,
  Lock,
  LogOut,
  Map,
  Search,
} from "lucide-react";
import { ZoneChart } from "@/components/desk/chart";
import { liveR, metricsOf, topAlert } from "@/lib/desk/engine";
import { fmtClock, fmtImpulse, fmtPx, fmtR, fmtSize, fmtUsd, fmtWhen } from "@/lib/desk/format";
import { DAY, HOUR } from "@/lib/desk/market";
import { RULES } from "@/lib/desk/rules";
import { useDesk, replayAlerts } from "@/lib/desk/store";
import type { Book, Plan, Position, Seat, SymbolId } from "@/lib/desk/types";

const SEATS: { id: Seat; label: string; icon: typeof Search }[] = [
  { id: "screen", label: "Screener", icon: Search },
  { id: "map", label: "Cartographer", icon: Map },
  { id: "risk", label: "Risk", icon: Calculator },
  { id: "gate", label: "Gate", icon: Inbox },
  { id: "exit", label: "Exit Clerk", icon: LogOut },
  { id: "audit", label: "Auditor", icon: BookOpen },
  { id: "rules", label: "Rules", icon: Lock },
];

function nextAt(now: number, pred: (t: number) => boolean): number {
  let t = now + HOUR;
  for (let i = 0; i < 24 * 8; i++) {
    if (pred(t)) return t;
    t += HOUR;
  }
  return t;
}

export function DeskApp() {
  const book = useDesk((s) => s.book);
  const seat = useDesk((s) => s.seat);
  const feed = useDesk((s) => s.feed);
  const feedNote = useDesk((s) => s.feedNote);
  const checkedAt = useDesk((s) => s.checkedAt);
  const setSeat = useDesk((s) => s.setSeat);

  const alert = topAlert(book.alerts);
  const latest = book.reports[book.reports.length - 1];
  const metrics = metricsOf(book);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    let cancel = false;
    let id = 0;
    void Promise.resolve(useDesk.persist.rehydrate()).then(() => {
      if (cancel) return;
      void useDesk.getState().sync();
      id = window.setInterval(() => void useDesk.getState().sync(), 3_000);
    });
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (typeof Notification === "undefined") setPerm("unsupported");
    else setPerm(Notification.permission);
  }, [feed, alert?.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const current = topAlert(useDesk.getState().book.alerts);
      if (!current || current.kind !== "GATE") return;
      if (e.key === "t" || e.key === "T") useDesk.getState().respond(current.id, "TAKEN");
      if (e.key === "s" || e.key === "S") useDesk.getState().respond(current.id, "SKIPPED");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const alertId = alert?.id ?? "";
  useEffect(() => {
    if (!alertId) return;
    document.getElementById("live-slip")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [alertId]);

  const clock = book.now > 0 ? book.now : Date.now();
  const next4h = nextAt(clock, (t) => new Date(t).getUTCHours() % 4 === 0);
  const nextDay = nextAt(clock, (t) => new Date(t).getUTCHours() === 0);
  const nextSun = (() => {
    let t = nextDay;
    while (new Date(t).getUTCDay() !== 0) t += DAY;
    return t;
  })();

  function enableNotifications() {
    if (typeof Notification === "undefined") return;
    void Notification.requestPermission().then((result) => {
      setPerm(result);
      if (result === "granted") replayAlerts();
    });
  }

  return (
    <div className="min-h-dvh bg-desk text-ink">
      <header className="border-b border-ink/15 bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="font-display text-3xl leading-none tracking-tight">Vellum</p>
            <p className="mt-1 text-xs text-muted">Live Coinbase hours. You only answer a slip.</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted">Paper balance</p>
            <p className="tabular-nums text-lg">{fmtUsd(book.balance)}</p>
            <p className={`mt-1 text-xs ${latest?.pass ? "text-ink" : "text-copper"}`}>
              {latest?.pass ? "Real size unlocked" : "Real size locked"}
            </p>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-4 pb-3 text-xs text-muted sm:px-6">
          <span className="shrink-0 tabular-nums text-ink">{book.now > 0 ? fmtWhen(book.now) : "Waiting for the hour"}</span>
          <span className="shrink-0 tabular-nums">
            {checkedAt ? `Checked ${new Date(checkedAt).toISOString().slice(11, 19)} UTC` : "Checking"}
          </span>
          <span className="shrink-0 tabular-nums">Next hour {fmtClock(clock + HOUR)}</span>
          <span className="shrink-0 tabular-nums">4H {fmtClock(next4h)}</span>
          <span className="shrink-0 tabular-nums">Daily {fmtClock(nextDay)}</span>
          <span className="shrink-0">Sunday {fmtWhen(nextSun).slice(0, 11)}</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
        <LiveSlip book={book} feed={feed} feedNote={feedNote} />
      </div>

      <div className="mx-auto grid max-w-6xl lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="flex gap-2 overflow-x-auto border-b border-ink/15 p-3 lg:flex-col lg:border-r lg:border-b-0 lg:overflow-visible">
          {SEATS.map((item) => {
            const Icon = item.icon;
            const active = seat === item.id;
            const needs =
              (item.id === "gate" && book.alerts.some((a) => a.kind === "GATE")) ||
              (item.id === "exit" && book.alerts.some((a) => a.kind !== "GATE"));
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSeat(item.id)}
                className={`flex min-h-11 shrink-0 items-center gap-2 border px-3 py-2 text-left text-sm ${
                  active ? "border-ink bg-ink text-paper" : "border-ink/15 bg-paper text-ink"
                }`}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                {needs ? <span className="size-2 rounded-full bg-copper desk-wait" /> : null}
              </button>
            );
          })}
        </nav>

        <main className="min-w-0 px-4 py-5 pb-28 sm:px-6">
          {seat === "screen" && <Screener book={book} />}
          {seat === "map" && <Mapper book={book} />}
          {seat === "risk" && <Risk book={book} />}
          {seat === "gate" && <Gate book={book} />}
          {seat === "exit" && <Exit book={book} />}
          {seat === "audit" && <Audit book={book} metricsPass={metrics.pass} />}
          {seat === "rules" && <Rules />}
          <Tape book={book} />
        </main>
      </div>

      <footer className="fixed inset-x-0 bottom-0 border-t border-ink/15 bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
          {perm === "default" ? (
            <button type="button" onClick={enableNotifications} className="min-h-11 bg-ink px-4 text-sm text-paper">
              Notify my phone
            </button>
          ) : (
            <p className="min-h-11 content-center px-1 text-sm">{perm === "granted" ? "Phone alerts on" : perm === "denied" ? "Alerts blocked" : "Alerts unavailable"}</p>
          )}
          <p className="min-w-0 flex-1 text-xs text-muted sm:text-right">
            {feed === "error"
              ? feedNote
              : feed === "loading"
                ? "Reading Coinbase."
                : `Live. Checks every 3 seconds. Install it on your home screen. It never sends an order.`}
          </p>
        </div>
      </footer>
    </div>
  );
}

function ruleLine(rule: string): string {
  if (rule.startsWith("HARD STOP")) return "Price traded the stop. The short is wrong. Close it. The clerk will not offer another candle.";
  if (rule.startsWith("TARGET")) return "Price reached twice the risk in your favor. The rule takes the win off.";
  if (rule.startsWith("STOP")) return "The stop had moved to entry, and price came back there. Close it flat.";
  if (rule.includes("BULLISH")) return "A 4-hour gap up closed back above the entry. The rule says this short is finished.";
  return rule;
}

function LiveSlip({ book, feed, feedNote }: { book: Book; feed: "loading" | "live" | "error"; feedNote: string }) {
  const respond = useDesk((s) => s.respond);
  const alert = topAlert(book.alerts);
  if (!alert) {
    return (
      <p id="live-slip" className="mb-5 border border-ink/15 bg-paper px-4 py-3 text-sm text-muted">
        {feed === "error"
          ? feedNote
          : feed === "loading"
            ? "Reading the last closed hours from Coinbase."
            : "Nothing is due on this closed hour. The desk checks again on its own. A short or an exit shows up here, and on your phone if alerts are on."}
      </p>
    );
  }

  const extra = book.alerts.length - 1;
  if (alert.kind === "GATE") {
    const plan = book.plans.find((p) => p.id === alert.planId);
    if (!plan) return null;
    return <GateSlip book={book} plan={plan} alertId={alert.id} extra={extra} onRespond={respond} />;
  }

  const pos = book.positions.find((p) => p.planId === alert.planId);
  if (!pos) return null;

  if (alert.kind === "EXIT") {
    return (
      <article id="live-slip" className="slip-in mb-5 border border-copper bg-paper" aria-live="assertive">
        <header className="flex items-baseline justify-between gap-3 border-b border-copper/30 px-4 py-3">
          <h2 className="font-display text-2xl text-copper">Exit now · {pos.coin}</h2>
          {extra > 0 ? <p className="text-xs text-muted">{extra} more after this</p> : null}
        </header>
        <p className="px-4 py-4 text-sm leading-relaxed">{ruleLine(alert.rule)}</p>
        <p className="px-4 pb-4 text-sm tabular-nums">
          {alert.rule} · close {fmtPx(alert.exitPrice)}
        </p>
        <button type="button" onClick={() => respond(alert.id, "CLOSED")} className="min-h-12 w-full bg-copper text-paper">
          Position closed
        </button>
      </article>
    );
  }

  return (
    <article id="live-slip" className="slip-in mb-5 border border-ink/15 bg-paper" aria-live="assertive">
      <header className="flex items-baseline justify-between gap-3 border-b border-ink/15 px-4 py-3">
        <h2 className="font-display text-2xl">Stale · {pos.coin}</h2>
        {extra > 0 ? <p className="text-xs text-muted">{extra} more after this</p> : null}
      </header>
      <p className="px-4 py-4 text-sm leading-relaxed">
        This short has stayed inside a quarter of its risk for 72 hours. It is not a winner and it is not a stop. Hold it, or close it at the market. The clerk does not pick.
      </p>
      <div className="grid grid-cols-2 border-t border-ink/15">
        <button type="button" onClick={() => respond(alert.id, "HOLD")} className="min-h-12 border-r border-ink/15">
          Hold
        </button>
        <button type="button" onClick={() => respond(alert.id, "CLOSED")} className="min-h-12 bg-ink text-paper">
          Close flat
        </button>
      </div>
    </article>
  );
}

function GateSlip({
  book,
  plan,
  alertId,
  extra,
  onRespond,
}: {
  book: Book;
  plan: Plan;
  alertId: string;
  extra: number;
  onRespond: (id: string, choice: "TAKEN" | "SKIPPED") => void;
}) {
  const watch = book.watchlist.find((row) => row.coin === plan.coin);
  const risk = plan.stop - plan.entry;
  const target = plan.entry - RULES.targetR * risk;
  return (
    <article id="live-slip" className="slip-in mb-5 max-w-3xl border border-ink bg-paper" aria-live="assertive">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/15 px-4 py-3">
        <h2 className="font-display text-2xl">Short {plan.coin}</h2>
        <p className="text-xs text-muted">
          Add {plan.addNumber}
          {extra > 0 ? ` · ${extra} more after this` : ""}
        </p>
      </header>
      <div className="space-y-3 px-4 py-4 text-sm leading-relaxed">
        <p>
          {watch
            ? `${plan.coin} is down ${fmtImpulse(watch.impulsePct)} from the ${RULES.anchorDays}-day high. `
            : ""}
          On the way down, price left a gap. It later traded back into that gap and closed underneath it, on a down candle. That is why this slip exists. The seats already checked the rules. They are not telling you the short will work.
        </p>
        <p>
          Take it if you want that short: sell {fmtPx(plan.entry)}, wrong at {fmtPx(plan.stop)}, aiming for {fmtPx(target)}. You risk {fmtUsd(plan.riskUsd)}, half a percent of the paper book, on {fmtSize(plan.size)} {plan.coin}.
        </p>
        <p className="text-muted">
          Skip it if the picture is not a short you want. A skip is still scored, so later you can see what passing would have made.
        </p>
      </div>
      <ZoneChart coin={plan.coin} now={book.now} zones={book.zones} highlightId={plan.zoneId} entry={plan.entry} stop={plan.stop} />
      <div className="grid grid-cols-2 border-t border-ink/15">
        <button type="button" onClick={() => onRespond(alertId, "TAKEN")} className="min-h-12 bg-ink text-paper">
          Take the short
        </button>
        <button type="button" onClick={() => onRespond(alertId, "SKIPPED")} className="min-h-12 border-l border-ink/15 bg-paper">
          Skip it
        </button>
      </div>
    </article>
  );
}

function SeatHead({ title, line }: { title: string; line: string }) {
  return (
    <header className="mb-5">
      <h1 className="font-display text-3xl leading-none">{title}</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">{line}</p>
    </header>
  );
}

function Screener({ book }: { book: Book }) {
  return (
    <section>
      <SeatHead
        title="Screener"
        line="Daily close only. A coin is watchlisted when the drop from the 14-day high is at least 8% and the low is still fresh."
      />
      {book.watchlist.length === 0 ? (
        <p className="border border-ink/15 bg-paper p-4 text-sm">No coin qualifies. The list stays empty until one does.</p>
      ) : (
        <div className="overflow-x-auto border border-ink/15 bg-paper">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-ink/15">
                <th className="px-3 py-2 font-medium">Coin</th>
                <th className="px-3 py-2 font-medium">Anchor high</th>
                <th className="px-3 py-2 font-medium">Current low</th>
                <th className="px-3 py-2 font-medium">Impulse</th>
                <th className="px-3 py-2 font-medium">Rank</th>
              </tr>
            </thead>
            <tbody>
              {book.watchlist.map((row, i) => (
                <tr key={row.coin} className="border-b border-ink/10 last:border-0">
                  <td className="px-3 py-3">{row.coin}</td>
                  <td className="px-3 py-3 tabular-nums">{fmtPx(row.anchorHigh)}</td>
                  <td className="px-3 py-3 tabular-nums">{fmtPx(row.currentLow)}</td>
                  <td className="px-3 py-3 tabular-nums">{fmtImpulse(row.impulsePct)}</td>
                  <td className="px-3 py-3 tabular-nums">{i + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Last screen {book.lastScreenAt ? fmtWhen(book.lastScreenAt) : "—"}. Output is the watchlist. This seat does not map zones.
      </p>
    </section>
  );
}

function Mapper({ book }: { book: Book }) {
  const coins = book.watchlist.map((w) => w.coin);
  const [coin, setCoin] = useState<SymbolId | null>(coins[0] ?? null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const active = coin && coins.includes(coin) ? coin : (coins[0] ?? null);
  const zones = book.zones.filter((z) => z.coin === active);
  const highlight = zones.find((z) => z.id === zoneId) ?? zones.find((z) => z.status !== "MITIGATED") ?? zones[0];

  return (
    <section>
      <SeatHead
        title="Cartographer"
        line="4H fair value gaps from the anchor high down to the low, ranked as a ladder. A wick marks it tested. A 1H rejection confirms it. This seat stops at the map."
      />
      {coins.length === 0 ? (
        <p className="border border-ink/15 bg-paper p-4 text-sm">Nothing on the watchlist, so there is nothing to map.</p>
      ) : (
        <>
          <div className="mb-3 flex gap-2 overflow-x-auto">
            {coins.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setCoin(id);
                  setZoneId(null);
                }}
                className={`min-h-11 shrink-0 border px-3 text-sm ${
                  id === active ? "border-ink bg-ink text-paper" : "border-ink/15 bg-paper"
                }`}
              >
                {id}
              </button>
            ))}
          </div>
          {active ? (
            <div className="border border-ink/15">
              <ZoneChart coin={active} now={book.now} zones={book.zones} highlightId={highlight?.id} />
            </div>
          ) : null}
          <div className="mt-3 overflow-x-auto border border-ink/15 bg-paper">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-ink/15">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Coin</th>
                  <th className="px-3 py-2 font-medium">Zone top</th>
                  <th className="px-3 py-2 font-medium">Zone bottom</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone, i) => (
                  <tr
                    key={zone.id}
                    className={`cursor-pointer border-b border-ink/10 last:border-0 ${
                      highlight?.id === zone.id ? "bg-copper/10" : ""
                    }`}
                    onClick={() => setZoneId(zone.id)}
                  >
                    <td className="px-3 py-3 tabular-nums">{i + 1}</td>
                    <td className="px-3 py-3">{zone.coin}</td>
                    <td className="px-3 py-3 tabular-nums">{fmtPx(zone.zoneTop)}</td>
                    <td className="px-3 py-3 tabular-nums">{fmtPx(zone.zoneBottom)}</td>
                    <td className="px-3 py-3">{zone.status}</td>
                    <td className="px-3 py-3">{zone.confirmed ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Risk({ book }: { book: Book }) {
  const unlocked = book.reports.some((r) => r.pass) && book.reports[book.reports.length - 1]?.pass;
  return (
    <section>
      <SeatHead
        title="Risk Officer"
        line="No charts. Balance times 0.50%, divided by the distance from entry to stop. An add is allowed only when the previous entry on that coin is at breakeven."
      />
      <p className="mb-4 border border-ink/15 bg-paper px-3 py-3 text-sm">
        Read-only paper balance <span className="tabular-nums">{fmtUsd(book.balance)}</span>
        <span className="text-muted"> · risk {fmtUsd(book.balance * RULES.riskPct)} · 0.50% locked</span>
      </p>
      <div className="overflow-x-auto border border-ink/15 bg-paper">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-ink/15">
              <th className="px-3 py-2 font-medium">Coin</th>
              <th className="px-3 py-2 font-medium">Entry</th>
              <th className="px-3 py-2 font-medium">Stop</th>
              <th className="px-3 py-2 font-medium">Size</th>
              <th className="px-3 py-2 font-medium">Risk %</th>
              <th className="px-3 py-2 font-medium">Add</th>
            </tr>
          </thead>
          <tbody>
            {book.plans.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-muted">
                  No plan yet. Confirmed zones arrive from the cartographer on the 1H close.
                </td>
              </tr>
            ) : (
              book.plans.map((plan) => (
                <tr key={plan.id} className="border-b border-ink/10 last:border-0">
                  <td className="px-3 py-3">{plan.coin}</td>
                  <td className="px-3 py-3 tabular-nums">{fmtPx(plan.entry)}</td>
                  <td className="px-3 py-3 tabular-nums">{fmtPx(plan.stop)}</td>
                  <td className="px-3 py-3 tabular-nums">{fmtSize(plan.size)}</td>
                  <td className="px-3 py-3 tabular-nums">0.50%</td>
                  <td className="px-3 py-3 tabular-nums">{plan.addNumber}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <h2 className="mt-6 font-display text-xl">Rejections</h2>
      <ul className="mt-2 border border-ink/15 bg-paper text-sm">
        {book.rejections.length === 0 ? (
          <li className="px-3 py-3 text-muted">None.</li>
        ) : (
          book.rejections.map((row) => (
            <li key={row.id} className="border-b border-ink/10 px-3 py-3 last:border-0">
              <span className="text-copper">{row.coin}</span>
              <span className="text-muted"> · {fmtWhen(row.at)} · </span>
              {row.reason}
            </li>
          ))
        )}
      </ul>
      {unlocked && book.realBalance ? (
        <p className="mt-4 text-sm text-muted">
          At a real balance of {fmtUsd(book.realBalance)}, the same 0.50% is {fmtUsd(book.realBalance * RULES.riskPct)}. The Gate still cannot send it.
        </p>
      ) : null}
    </section>
  );
}

function Gate({ book }: { book: Book }) {
  return (
    <section>
      <SeatHead
        title="Gate"
        line="This seat only talks when a short is ready. The slip itself sits at the top of the page. Take it or skip it there. There is still no order button."
      />
      <h2 className="font-display text-xl">What you already answered</h2>
      <ul className="mt-2 max-w-xl border border-ink/15 bg-paper text-sm">
        {book.decisions.length === 0 ? (
          <li className="px-3 py-3 text-muted">None yet.</li>
        ) : (
          [...book.decisions].reverse().map((d) => {
            const planRow = book.plans.find((p) => p.id === d.planId);
            return (
              <li key={d.planId} className="border-b border-ink/10 px-3 py-3 last:border-0">
                <span className={d.decision === "SKIPPED" ? "text-copper" : ""}>{d.decision}</span>
                <span className="text-muted"> · {planRow?.coin} · add {planRow?.addNumber} · </span>
                <span className="tabular-nums">{fmtWhen(d.at)}</span>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

function Exit({ book }: { book: Book }) {
  const open = book.positions.filter((p) => p.status === "OPEN");

  return (
    <section>
      <SeatHead
        title="Exit Clerk"
        line="Checked on the 4-hour and the daily close. Exit now and stale calls stop the tape at the top. This list is just what is still open."
      />
      <h2 className="font-display text-xl">Open book</h2>
      <ul className="mt-2 border border-ink/15 bg-paper text-sm">
        {open.length === 0 ? (
          <li className="px-3 py-3 text-muted">Flat.</li>
        ) : (
          open.map((p) => <OpenRow key={p.planId} pos={p} now={book.now} />)
        )}
      </ul>
    </section>
  );
}

function OpenRow({ pos, now }: { pos: Position; now: number }) {
  const r = liveR(pos, now);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/10 px-3 py-3 last:border-0">
      <span>
        {pos.coin} · add {pos.addNumber}
        {pos.breakeven ? " · stop at entry" : ""}
      </span>
      <span className="tabular-nums text-muted">
        {fmtPx(pos.entry)} → {fmtPx(pos.stop)}
        {r === null ? "" : ` · mark ${fmtR(r)}`}
      </span>
    </li>
  );
}

function Audit({ book, metricsPass }: { book: Book; metricsPass: boolean }) {
  const metrics = metricsOf(book);
  const setReal = useDesk((s) => s.setReal);
  const reset = useDesk((s) => s.reset);
  const [arm, setArm] = useState(false);
  const latest = book.reports[book.reports.length - 1];
  const unlocked = Boolean(latest?.pass);
  const skipped = book.journal.filter((j) => j.kind === "SKIPPED");
  const width = 280;
  const height = 72;
  const eq = metrics.equity;
  const min = Math.min(...eq);
  const max = Math.max(...eq);
  const span = max - min || 1;
  const d = eq
    .map((v, i) => {
      const x = eq.length === 1 ? 0 : (i / (eq.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 8) - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const rows: { label: string; value: string; ok: boolean; rule: string }[] = [
    { label: "Trades", value: `${metrics.trades}`, ok: metrics.checks.trades, rule: `≥ ${RULES.thresholds.trades}` },
    {
      label: "Win rate",
      value: metrics.trades ? `${(metrics.winRate * 100).toFixed(1)}%` : "—",
      ok: metrics.checks.winRate,
      rule: "≥ 33%",
    },
    {
      label: "Expectancy",
      value: metrics.trades ? fmtR(metrics.expectancy) : "—",
      ok: metrics.checks.expectancy,
      rule: "≥ +0.40R",
    },
    {
      label: "Max drawdown",
      value: `${(metrics.maxDd * 100).toFixed(1)}%`,
      ok: metrics.checks.maxDd,
      rule: "≤ 20%",
    },
  ];

  return (
    <section>
      <SeatHead
        title="Auditor"
        line="Every fill, fee, and slippage is its own line. Skipped slips are scored as if they had been taken. Thresholds are not a suggestion."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="border border-ink/15 bg-paper px-3 py-3">
            <p className="text-xs text-muted">
              {row.label} · {row.rule}
            </p>
            <p className="mt-1 flex items-baseline justify-between">
              <span className="tabular-nums text-2xl">{row.value}</span>
              <span className={row.ok ? "text-ink" : "text-copper"}>{row.ok ? "Pass" : "Fail"}</span>
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm">
        Live tally is {metricsPass ? "a pass" : "a no-go"}. It is not the Sunday report.
        {latest
          ? ` Latest Sunday is ${latest.pass ? "GO" : "NO-GO"} · ${fmtWhen(latest.at)}.`
          : " No Sunday has closed on this tape yet."}
      </p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-20 w-full max-w-md border border-ink/15 bg-paper" aria-hidden="true">
        <path d={d} fill="none" stroke="var(--color-ink)" strokeWidth="1.5" />
      </svg>
      <p className="mt-2 max-w-md text-sm text-muted">
        Paper balance after each closed short, starting at {fmtUsd(RULES.startingBalance)}. Up is the book making money. A dip is the drawdown the Sunday rule measures.
      </p>
      <div className="mt-4 max-w-md border border-ink/15 bg-paper p-4">
        {unlocked ? (
          <label className="block text-sm">
            Real account, if you had one
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={book.realBalance ?? ""}
              onChange={(e) => setReal(e.target.value === "" ? null : Number(e.target.value))}
              className="mt-2 min-h-11 w-full border border-ink/20 bg-paper px-3 tabular-nums"
            />
            <span className="mt-2 block text-xs text-muted">
              Sizing uses the same 0.50%. The Gate cannot send the order. That permission does not exist.
            </span>
          </label>
        ) : (
          <p className="text-sm">
            <Lock className="mr-1 inline size-4" aria-hidden="true" />
            Real size stays locked until the latest Sunday report passes all four. A good week does not move the bar.
          </p>
        )}
      </div>
      <h2 className="mt-6 font-display text-xl">Journal</h2>
      <ul className="mt-2 border border-ink/15 bg-paper text-sm">
        {book.journal.length === 0 ? (
          <li className="px-3 py-3 text-muted">Empty. Taken trades and skipped results land here.</li>
        ) : (
          [...book.journal].reverse().slice(0, 40).map((line) => (
            <li key={line.id} className="border-b border-ink/10 px-3 py-2 last:border-0">
              <span className="text-xs text-muted">{line.kind} · </span>
              <span className={line.kind === "RESULT" && (line.r ?? 0) < 0 ? "text-copper" : ""}>{line.text}</span>
            </li>
          ))
        )}
      </ul>
      {book.journal.length > 40 ? (
        <p className="mt-2 text-xs text-muted">Showing the latest 40 lines of {book.journal.length}.</p>
      ) : null}
      <h2 className="mt-6 font-display text-xl">Skipped</h2>
      <ul className="mt-2 border border-ink/15 bg-paper text-sm">
        {skipped.length === 0 ? (
          <li className="px-3 py-3 text-muted">
            None resolved. A skip is tracked until the same exit rule would have fired.
          </li>
        ) : (
          skipped.map((line) => (
            <li key={line.id} className="border-b border-ink/10 px-3 py-2 last:border-0">
              {line.text}
            </li>
          ))
        )}
      </ul>
      <div className="mt-6">
        {arm ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => reset()} className="min-h-11 bg-copper px-4 text-sm text-paper">
              Clear the paper book
            </button>
            <button type="button" onClick={() => setArm(false)} className="min-h-11 border border-ink/20 px-4 text-sm">
              Keep it
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setArm(true)} className="min-h-11 border border-ink/20 px-4 text-sm">
            Reset paper book
          </button>
        )}
      </div>
    </section>
  );
}

function Rules() {
  return (
    <section className="max-w-xl">
      <SeatHead
        title="Desk rules"
        line="Locked. The auditor scores them. Nobody edits them because a week was kind or cruel."
      />
      <div className="space-y-4 text-sm leading-relaxed">
        <Rule n="01" title="Screener, daily close">
          Anchor is the highest 4H high in {RULES.anchorDays} days. Impulse is that high down to the low since. A coin is watchlisted at {fmtImpulse(RULES.impulseMin)} or more, if the low printed within {RULES.lowFreshDays} days. Ranked by impulse. Every qualifier stays.
        </Rule>
        <Rule n="02" title="Cartographer">
          Bearish 4H fair value gap: the third candle’s high is below the first candle’s low, and the middle candle is the displacement. Zone top is the first low. Zone bottom is the third high. The gap’s own three candles do not count as a test. A later wick, even partial, marks TESTED. A 1H candle that wicks in and closes back below the zone, bearish, marks confirmed. A close above the zone top mitigates it.
        </Rule>
        <Rule n="03" title="Risk">
          Short the proximal edge. Entry is the zone bottom. Stop is the zone top. Size is paper balance × 0.50% ÷ (stop − entry). Add only if the open entry on that coin is already at breakeven — stop moved to entry after +1R. Otherwise reject and log why.
        </Rule>
        <Rule n="04" title="Gate">
          One message: coin, zone, entry, stop, size, risk, and the same 4H frame every time. Reply is TAKEN or SKIPPED. The Gate does not send orders.
        </Rule>
        <Rule n="05" title="Exits, 4H and daily">
          HARD STOP if price trades the stop. TARGET 2R if price trades two times the risk in favor. If both could be true on one candle, the stop wins. BULLISH 4H FVG AGAINST THE SHORT if a 4H gap up closes entirely back above entry without having hit the stop. STALE if the last 72 hours stayed inside ±0.25R — you decide, the clerk does not.
        </Rule>
        <Rule n="06" title="Journal">
          Entry, exit, fee ({RULES.feeBps} bps a side), and slippage ({RULES.slipBps} bps a side) are separate lines. Result is net, in R. A skip is logged with the R it would have returned.
        </Rule>
        <Rule n="07" title="Sunday">
          Trades ≥ {RULES.thresholds.trades}. Win rate ≥ 33%. Expectancy ≥ +0.40R. Max drawdown ≤ 20%. All four, on the closed taken book. A pass unlocks a real-size figure. It does not unlock an exchange.
        </Rule>
      </div>
    </section>
  );
}

function Rule({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <article className="border border-ink/15 bg-paper px-4 py-3">
      <h2 className="font-display text-lg">
        <span className="mr-2 text-muted">{n}</span>
        {title}
      </h2>
      <p className="mt-1 text-muted">{children}</p>
    </article>
  );
}

function Tape({ book }: { book: Book }) {
  const lines = book.tape.slice(-5);
  if (!lines.length) return null;
  return (
    <ol className="mt-8 max-w-xl border-t border-ink/15 pt-3 text-xs text-muted">
      {lines.map((line, i) => (
        <li key={`${line.at}-${i}`} className="py-1">
          <span className="text-ink">{line.seat}</span> · {line.text}
        </li>
      ))}
    </ol>
  );
}
