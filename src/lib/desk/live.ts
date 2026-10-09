import { createServerFn } from "@tanstack/react-start";
import { COINS, HOUR } from "./market";
import type { Candle, SymbolId } from "./types";

const PRODUCT: Record<SymbolId, string> = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  AVAX: "AVAX-USD",
  LINK: "LINK-USD",
  SUI: "SUI-USD",
  NEAR: "NEAR-USD",
  DOGE: "DOGE-USD",
};

async function page(product: string, startSec: number, endSec: number): Promise<Candle[]> {
  const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=3600&start=${startSec}&end=${endSec}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${product} ${res.status}`);
  const rows = (await res.json()) as number[][];
  if (!Array.isArray(rows)) throw new Error(`${product} unexpected`);
  return rows.map((row) => ({
    t: Number(row[0]) * 1000,
    l: Number(row[1]),
    h: Number(row[2]),
    o: Number(row[3]),
    c: Number(row[4]),
  }));
}

export const fetchKlines = createServerFn({ method: "POST" })
  .inputValidator((input: { recent?: boolean }) => ({ recent: Boolean(input?.recent) }))
  .handler(async ({ data }) => {
  const end = Math.floor(Date.now() / 1000);
  const recent = data.recent;
  const mid = end - 299 * 3600;
  const start = recent ? end - 8 * 3600 : mid - 299 * 3600;
  const candles = {} as Record<SymbolId, Candle[]>;
  const queue = [...COINS];
  const workers = Array.from({ length: recent ? 4 : 3 }, async () => {
    for (;;) {
      const coin = queue.shift();
      if (!coin) return;
      const product = PRODUCT[coin];
      const rows = recent
        ? await page(product, start, end)
        : [...(await page(product, start, mid)), ...(await page(product, mid, end))];
      const map = new Map<number, Candle>();
      for (const candle of rows) {
        if (!Number.isFinite(candle.t) || !Number.isFinite(candle.c)) continue;
        if (candle.t + HOUR > Date.now()) continue;
        map.set(candle.t, candle);
      }
      const bars = [...map.values()].sort((a, b) => a.t - b.t);
      if (bars.length < (recent ? 1 : 48)) throw new Error(`${coin} short history`);
      candles[coin] = bars;
    }
  });
  await Promise.all(workers);
  const asOf = Math.min(...COINS.map((coin) => candles[coin]![candles[coin]!.length - 1]!.t + HOUR));
  return { candles, asOf };
  });
