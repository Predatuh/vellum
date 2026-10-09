import { MARKET } from "./market";
import type { Candle, SymbolId } from "./types";

let candles: Record<SymbolId, Candle[]> = MARKET.candles;

export function candleTape(): Record<SymbolId, Candle[]> {
  return candles;
}

export function setCandleTape(next: Record<SymbolId, Candle[]>) {
  candles = next;
}
