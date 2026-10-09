import { h4 } from "@/lib/desk/engine";
import { fmtPx } from "@/lib/desk/format";
import { H4 } from "@/lib/desk/market";
import { RULES } from "@/lib/desk/rules";
import type { SymbolId, Zone } from "@/lib/desk/types";

const W = 640;
const H = 300;
const PAD_L = 12;
const PAD_R = 78;
const PAD_T = 16;
const PAD_B = 22;

export function ZoneChart({
  coin,
  now,
  zones,
  highlightId,
  entry,
  stop,
}: {
  coin: SymbolId;
  now: number;
  zones: Zone[];
  highlightId?: string;
  entry?: number;
  stop?: number;
}) {
  const bars = h4(coin, now).slice(-48);
  if (bars.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center border border-ink/15 bg-paper text-sm text-muted">
        Not enough 4H bars yet.
      </div>
    );
  }

  const target =
    entry !== undefined && stop !== undefined ? entry - (stop - entry) * RULES.targetR : undefined;
  const mine = zones.filter((z) => z.coin === coin);
  const last = bars[bars.length - 1]!.c;
  let lo = Math.min(...bars.map((b) => b.l));
  let hi = Math.max(...bars.map((b) => b.h));
  for (const z of mine) {
    lo = Math.min(lo, z.zoneBottom);
    hi = Math.max(hi, z.zoneTop);
  }
  for (const price of [entry, stop, target, last]) {
    if (price === undefined) continue;
    lo = Math.min(lo, price);
    hi = Math.max(hi, price);
  }
  const span = hi - lo || hi * 0.01;
  lo -= span * 0.08;
  hi += span * 0.08;

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const y = (price: number) => PAD_T + ((hi - price) / (hi - lo)) * innerH;
  const x = (i: number) => PAD_L + (i + 0.5) * (innerW / bars.length);
  const slot = innerW / bars.length;
  const t0 = bars[0]!.t;
  const t1 = bars[bars.length - 1]!.t;

  const tags: { key: string; at: number; text: string; fill: string }[] = [
    { key: "now", at: y(last), text: "now", fill: "var(--color-muted)" },
  ];
  if (stop !== undefined) tags.push({ key: "stop", at: y(stop), text: "stop", fill: "var(--color-copper)" });
  if (entry !== undefined) tags.push({ key: "entry", at: y(entry), text: "entry", fill: "var(--color-ink)" });
  if (target !== undefined) tags.push({ key: "target", at: y(target), text: "2R", fill: "var(--color-ink)" });
  tags.sort((a, b) => a.at - b.at);
  let cursor = -999;
  const placed = tags.map((tag) => {
    const at = Math.max(tag.at, cursor + 13);
    cursor = at;
    return { ...tag, at };
  });

  return (
    <figure className="bg-paper">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full sm:h-72" role="img" aria-label={entry !== undefined ? `${coin} short: gap, entry, stop, and 2R target` : `${coin} 4H chart with fair value gaps`}>
        <rect x="0" y="0" width={W} height={H} fill="var(--color-paper)" />
        {mine.map((zone) => {
          const active = zone.id === highlightId || (highlightId === undefined && zone.status !== "MITIGATED");
          const yTop = y(zone.zoneTop);
          const yBot = y(zone.zoneBottom);
          const start = bars.findIndex((b) => b.t + H4 > zone.formedAt);
          const x0 = start <= 0 ? PAD_L : x(start) - slot / 2;
          const top = Math.min(yTop, yBot);
          const height = Math.abs(yBot - yTop);
          return (
            <g key={zone.id}>
              <rect
                x={x0}
                y={top}
                width={Math.max(0, W - PAD_R - x0)}
                height={height}
                fill={active ? "var(--color-copper)" : "var(--color-ink)"}
                fillOpacity={zone.status === "MITIGATED" ? 0.04 : active ? 0.16 : 0.06}
                stroke={active ? "var(--color-copper)" : "var(--color-ink)"}
                strokeOpacity={active ? 0.85 : 0.2}
              />
              {active && height > 16 ? (
                <text x={x0 + 8} y={top + 14} fill="var(--color-copper)" fontSize="11" fontFamily="IBM Plex Mono, ui-monospace, monospace">
                  gap
                </text>
              ) : null}
            </g>
          );
        })}
        {bars.map((bar, i) => {
          const up = bar.c >= bar.o;
          const cx = x(i);
          const bodyTop = y(Math.max(bar.o, bar.c));
          const bodyBot = y(Math.min(bar.o, bar.c));
          return (
            <g key={bar.t}>
              <line x1={cx} x2={cx} y1={y(bar.h)} y2={y(bar.l)} stroke="var(--color-ink)" strokeWidth="1" />
              <rect
                x={cx - Math.max(1.5, slot * 0.28)}
                y={bodyTop}
                width={Math.max(3, slot * 0.56)}
                height={Math.max(1, bodyBot - bodyTop)}
                fill={up ? "var(--color-paper)" : "var(--color-ink)"}
                stroke="var(--color-ink)"
                strokeWidth="1"
              />
            </g>
          );
        })}
        {entry !== undefined ? (
          <line x1={PAD_L} x2={W - PAD_R} y1={y(entry)} y2={y(entry)} stroke="var(--color-ink)" strokeDasharray="4 3" strokeWidth="1.25" />
        ) : null}
        {stop !== undefined ? (
          <line x1={PAD_L} x2={W - PAD_R} y1={y(stop)} y2={y(stop)} stroke="var(--color-copper)" strokeWidth="1.5" />
        ) : null}
        {target !== undefined ? (
          <line x1={PAD_L} x2={W - PAD_R} y1={y(target)} y2={y(target)} stroke="var(--color-ink)" strokeDasharray="1 3" strokeWidth="1.25" />
        ) : null}
        {placed.map((tag) => (
          <text key={tag.key} x={W - PAD_R + 8} y={tag.at + 4} fill={tag.fill} fontSize="11" fontFamily="IBM Plex Mono, ui-monospace, monospace">
            {tag.text}
          </text>
        ))}
        <text x={PAD_L} y={H - 6} fill="var(--color-muted)" fontSize="11" fontFamily="IBM Plex Mono, ui-monospace, monospace">
          {coin} · 4H · {new Date(t0).toISOString().slice(5, 10)} – {new Date(t1).toISOString().slice(5, 10)}
        </text>
      </svg>
      <figcaption className="border-t border-ink/10 px-4 py-3 text-sm leading-relaxed text-muted">
        {entry !== undefined && stop !== undefined && target !== undefined ? (
          <>
            <span className="text-ink">Gap</span> is the shaded band — the empty space price left behind on the way down.{" "}
            <span className="text-ink">Entry</span> is the dashed line, the bottom of that gap, where this short would start.{" "}
            <span className="text-copper">Stop</span> is the top of the gap. If price trades there, the idea is wrong.{" "}
            <span className="text-ink">2R</span> is the win: twice that distance in your favor, at {fmtPx(target)}.{" "}
            <span className="text-ink">Now</span> is the last closed hour, {fmtPx(last)}.
          </>
        ) : (
          <>
            Each shaded band is a 4H gap, ranked from the high down. The copper one is the gap in front of you. A wick into it means tested. A down close back underneath is what lets a slip exist. A close above the top kills the gap.
          </>
        )}
      </figcaption>
    </figure>
  );
}
