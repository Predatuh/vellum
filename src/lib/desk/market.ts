import type { Candle, SymbolId } from "./types";

export const HOUR = 3_600_000;
export const H4 = 4 * HOUR;
export const DAY = 24 * HOUR;
export const T0 = Date.UTC(2026, 5, 1, 0, 0, 0);

export const COINS: SymbolId[] = ["BTC", "ETH", "SOL", "AVAX", "LINK", "SUI", "NEAR", "DOGE"];

type Outcome = "target" | "stop" | "fvg-against" | "stale-target" | "stale-stop";
type Special = "none" | "add" | "reject";

const SPECS: { id: SymbolId; px: number; delay: number; special: Special }[] = [
  { id: "BTC", px: 64_000, delay: 0, special: "none" },
  { id: "ETH", px: 3_400, delay: 16, special: "none" },
  { id: "SOL", px: 150, delay: 32, special: "add" },
  { id: "AVAX", px: 28, delay: 48, special: "reject" },
  { id: "LINK", px: 15, delay: 64, special: "none" },
  { id: "SUI", px: 2.1, delay: 80, special: "none" },
  { id: "NEAR", px: 4.2, delay: 96, special: "none" },
  { id: "DOGE", px: 0.16, delay: 112, special: "none" },
];

const OUTCOMES: Record<SymbolId, Outcome[]> = {
  BTC: ["target", "stop", "target", "stale-target", "target", "stop"],
  ETH: ["target", "fvg-against", "target", "target", "stop", "target"],
  SOL: ["target", "stop", "target", "target", "fvg-against", "target"],
  AVAX: ["target", "stop", "stale-stop", "target", "target", "fvg-against"],
  LINK: ["stop", "target", "target", "fvg-against", "target", "stale-target"],
  SUI: ["target", "stale-target", "stop", "target", "target", "stop"],
  NEAR: ["target", "target", "fvg-against", "stop", "target", "target"],
  DOGE: ["fvg-against", "target", "target", "stale-target", "stop", "target"],
};

export type Mark = { coin: SymbolId; open: number; kind: string };

class Path {
  candles: Candle[] = [];
  t: number;
  px: number;

  constructor(start: number) {
    this.px = start;
    this.t = T0;
  }

  aligned() {
    if ((this.t - T0) % H4 !== 0) {
      throw new Error(`unaligned at ${(this.t - T0) / HOUR}h`);
    }
  }

  private bar(o: number, h: number, l: number, c: number) {
    const hi = Math.max(h, o, c);
    const lo = Math.min(l, o, c);
    if (!(hi >= lo)) throw new Error("inverted bar");
    this.candles.push({ t: this.t, o, h: hi, l: lo, c });
    this.t += HOUR;
    this.px = c;
  }

  drift(hours: number, to: number, wickPct: number, ceiling?: number) {
    const from = this.px;
    for (let i = 0; i < hours; i++) {
      const o = from + ((to - from) * i) / hours;
      const c = from + ((to - from) * (i + 1)) / hours;
      const w = Math.max(Math.abs(c), 1e-8) * wickPct;
      let hi = Math.max(o, c) + w;
      let lo = Math.min(o, c) - w;
      if (ceiling !== undefined) hi = Math.min(hi, ceiling);
      this.bar(o, hi, lo, c);
    }
  }

  flat(hours: number, price: number) {
    for (let i = 0; i < hours; i++) {
      const o = price * (1 + Math.sin(i) * 0.0003);
      const c = price * (1 + Math.sin(i + 0.7) * 0.0003);
      this.bar(o, price * 1.0008, price * 0.9992, c);
    }
  }

  /** Bearish 4H FVG. Candle A low = gapTop, candle C high = gapBot. */
  bearFvg(gapTop: number, gapBot: number, floor?: number, maxHigh?: number) {
    this.aligned();
    const pit = floor ?? gapBot * 0.984;
    if (!(gapBot < gapTop && pit < gapBot)) {
      throw new Error(`bad gap top ${gapTop} bot ${gapBot} pit ${pit}`);
    }
    const aHi = Math.min(gapTop * 1.003, maxHigh ?? gapTop * 1.003);
    if (!(aHi > gapTop)) throw new Error("no room above gap top");
    for (let i = 0; i < 4; i++) {
      const o = gapTop + (aHi - gapTop) * 0.35;
      const c = gapTop + (aHi - gapTop) * 0.65;
      this.bar(o, aHi, gapTop, c);
    }
    for (let i = 0; i < 4; i++) {
      const o = gapTop + ((pit - gapTop) * i) / 4;
      const c = gapTop + ((pit - gapTop) * (i + 1)) / 4;
      this.bar(o, Math.max(o, c), Math.min(o, c), c);
    }
    for (let i = 0; i < 4; i++) {
      const raw = gapBot - (gapBot - pit) * ((i + 1) / 4);
      const cc = Math.min(gapBot, Math.max(pit, raw));
      const oo = Math.min(gapBot, Math.max(pit, cc + (gapBot - pit) * 0.2));
      this.bar(oo, gapBot, pit, cc);
    }
  }

  /**
   * Three 4H bars that gap up and close entirely above `entry`,
   * without trading `stop`.
   */
  bullishAgainst(stop: number, entry: number) {
    this.aligned();
    const aHigh = entry * 0.996;
    const aLo = aHigh * 0.992;
    for (let i = 0; i < 4; i++) {
      this.bar(aLo * 1.001, aHigh, aLo, aHigh * 0.997);
    }
    const cLow = entry * 1.002;
    const cHigh = stop * 0.988;
    if (!(cLow > aHigh && cLow < cHigh && cHigh < stop)) {
      throw new Error(`no room for opposing gap entry ${entry} stop ${stop}`);
    }
    for (let i = 0; i < 4; i++) {
      const o = aHigh + ((cLow - aHigh) * i) / 4;
      const c = aHigh + ((cLow - aHigh) * (i + 1)) / 4;
      this.bar(o, Math.max(o, c), Math.min(o, c), c);
    }
    for (let i = 0; i < 4; i++) {
      const c = cLow + (cHigh - cLow) * ((i + 1) / 4);
      const o = cLow + (c - cLow) * 0.4;
      this.bar(o, cHigh, cLow, c);
    }
  }

  approach(zoneBot: number, hours: number) {
    const dest = zoneBot * 0.993;
    this.drift(hours, dest, 0.0003);
    if (this.px >= zoneBot) throw new Error("approach entered the zone");
  }

  confirm(
    zoneBot: number,
    zoneTop: number,
    marks: Mark[],
    coin: SymbolId,
    kind: string,
    shallow = false,
  ) {
    const o = zoneBot * (shallow ? 0.9991 : 0.9975);
    const h = zoneBot + (zoneTop - zoneBot) * 0.42;
    const c = zoneBot * (shallow ? 0.9983 : 0.9952);
    const l = shallow ? c : c * 0.9993;
    if (!(h < zoneTop && h > zoneBot && c < zoneBot && c < o && l <= c)) {
      throw new Error("confirm bar does not qualify");
    }
    marks.push({ coin, open: this.t, kind });
    this.bar(o, h, l, c);
  }

  chop(hours: number, entry: number, risk: number) {
    const band = risk * 0.12;
    for (let i = 0; i < hours; i++) {
      const wobble = Math.sin(i * 0.9) * band * 0.2;
      this.bar(entry + wobble, entry + band, entry - band, entry - wobble);
    }
  }
}

function resolve(path: Path, zoneBot: number, zoneTop: number, outcome: Outcome) {
  const risk = zoneTop - zoneBot;
  const target = zoneBot - 2 * risk;
  if (outcome === "target") {
    path.drift(12, target * 0.999, 0.0004);
    return;
  }
  if (outcome === "stop") {
    path.drift(8, zoneTop * 1.004, 0.0003);
    return;
  }
  if (outcome === "fvg-against") {
    path.bullishAgainst(zoneTop, zoneBot);
    return;
  }
  path.chop(84, zoneBot, risk);
  if (outcome === "stale-target") path.drift(12, target * 0.999, 0.0004);
  else path.drift(8, zoneTop * 1.004, 0.0003);
}

function runStandard(
  path: Path,
  marks: Mark[],
  coin: SymbolId,
  level: number,
  outcome: Outcome,
) {
  const zoneTop = level * 0.972;
  const zoneBot = level * 0.956;
  const low = level * 0.89;
  path.drift(72, level, 0.0007);
  path.bearFvg(zoneTop, zoneBot);
  path.drift(8, low, 0.0005);
  path.drift(36, low, 0.00025);
  path.approach(zoneBot, 7);
  path.confirm(zoneBot, zoneTop, marks, coin, "confirm");
  resolve(path, zoneBot, zoneTop, outcome);
}

function runAdd(path: Path, marks: Mark[], coin: SymbolId, level: number) {
  const upperTop = level * 0.985;
  const upperBot = level * 0.97;
  const risk = upperTop - upperBot;
  const be = upperBot - risk;
  const target = upperBot - 2 * risk;
  const low = level * 0.89;
  path.drift(72, level, 0.0007);
  path.bearFvg(upperTop, upperBot);
  path.drift(8, low, 0.0005);
  path.drift(36, low, 0.00025);
  path.approach(upperBot, 7);
  path.confirm(upperBot, upperTop, marks, coin, "confirm");

  // Tag +1R (breakeven) without reaching the 2R target.
  const beDest = be * 0.9985;
  if (!(beDest < be && beDest > target)) throw new Error("be dest");
  path.drift(8, beDest, 0.00015, upperBot);

  // Second rung sits between the breakeven stop (entry) and price.
  const gapTop = upperBot - risk * 0.45;
  const gapBot = upperBot - risk * 0.82;
  const pit = target * 1.008;
  if (!(pit < gapBot * 0.993 && pit > target && gapTop * 1.003 < upperBot && gapBot < gapTop)) {
    throw new Error(`add pocket ${gapTop} ${gapBot} pit ${pit} be ${upperBot} tgt ${target}`);
  }
  path.drift(8, gapTop, 0.00012, upperBot * 0.9985);
  path.bearFvg(gapTop, gapBot, pit, upperBot * 0.9985);
  path.approach(gapBot, 7);
  path.confirm(gapBot, gapTop, marks, coin, "add-confirm");
  path.drift(12, target * 0.999, 0.00025, upperBot * 0.999);
}

function runReject(path: Path, marks: Mark[], coin: SymbolId, level: number) {
  const upperTop = level * 0.985;
  const upperBot = level * 0.97;
  const risk = upperTop - upperBot;
  const be = upperBot - risk;
  const target = upperBot - 2 * risk;
  const low = level * 0.89;
  path.drift(72, level, 0.0007);
  path.bearFvg(upperTop, upperBot);
  path.drift(8, low, 0.0005);
  path.drift(36, low, 0.00025);
  path.approach(upperBot, 7);
  path.confirm(upperBot, upperTop, marks, coin, "confirm");

  const gapTop = upperBot * 0.994;
  const gapBot = upperBot * 0.989;
  const pit = be * 1.004;
  if (!(pit < gapBot && pit > be)) throw new Error("reject pit tags breakeven");
  const shallowLow = gapBot * 0.9983;
  if (!(shallowLow > be)) throw new Error("reject confirm would tag breakeven");
  path.drift(4, gapTop, 0.00008, upperTop * 0.992);
  path.bearFvg(gapTop, gapBot, pit, upperTop * 0.992);
  path.drift(7, gapBot * 0.998, 0, gapBot * 0.999);
  path.confirm(gapBot, gapTop, marks, coin, "reject-confirm", true);
  path.drift(12, target * 0.999, 0.0003);
}

function buildCoin(spec: (typeof SPECS)[number], marks: Mark[]): Candle[] {
  const path = new Path(spec.px * 0.9);
  path.flat(spec.delay, spec.px * 0.9);
  let level = spec.px;
  const outcomes = OUTCOMES[spec.id];
  for (let n = 0; n < outcomes.length; n++) {
    path.aligned();
    if (n === 0 && spec.special === "add") runAdd(path, marks, spec.id, level);
    else if (n === 0 && spec.special === "reject") runReject(path, marks, spec.id, level);
    else runStandard(path, marks, spec.id, level, outcomes[n]!);
    level *= 1.05;
  }
  path.flat(48, path.px);
  return path.candles;
}

export type Market = {
  candles: Record<SymbolId, Candle[]>;
  openAt: number;
  marks: Mark[];
};

function buildMarket(): Market {
  const marks: Mark[] = [];
  const candles = {} as Record<SymbolId, Candle[]>;
  for (const spec of SPECS) candles[spec.id] = buildCoin(spec, marks);
  const first = marks.find((m) => m.coin === "BTC" && m.kind === "confirm");
  if (!first) throw new Error("BTC never confirmed");
  return { candles, openAt: first.open, marks };
}

export const MARKET: Market = buildMarket();

export function resample(candles: Candle[], size: number, now: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    if (c.t + HOUR > now) break;
    const b = Math.floor(c.t / size) * size;
    if (b + size > now) continue;
    const cur = buckets.get(b);
    if (!cur) buckets.set(b, { t: b, o: c.o, h: c.h, l: c.l, c: c.c });
    else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

export function closedH1(candles: Candle[], now: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    if (c.t + HOUR > now) break;
    out.push(c);
  }
  return out;
}
