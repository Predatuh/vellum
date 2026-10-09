export type SymbolId =
  | "BTC"
  | "ETH"
  | "SOL"
  | "AVAX"
  | "LINK"
  | "SUI"
  | "NEAR"
  | "DOGE";

export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
};

export type ZoneStatus = "OPEN" | "TESTED" | "MITIGATED";

export type Zone = {
  id: string;
  coin: SymbolId;
  zoneTop: number;
  zoneBottom: number;
  formedAt: number;
  status: ZoneStatus;
  confirmed: boolean;
};

export type WatchRow = {
  coin: SymbolId;
  anchorHigh: number;
  anchorTime: number;
  currentLow: number;
  impulsePct: number;
};

export type Plan = {
  id: string;
  at: number;
  coin: SymbolId;
  zoneId: string;
  zoneTop: number;
  zoneBottom: number;
  entry: number;
  stop: number;
  size: number;
  riskPct: number;
  riskUsd: number;
  addNumber: number;
};

export type Rejection = {
  id: string;
  at: number;
  coin: SymbolId;
  zoneId: string;
  zoneTop: number;
  zoneBottom: number;
  reason: string;
};

export type DecisionKind = "TAKEN" | "SKIPPED";

export type Decision = {
  planId: string;
  at: number;
  decision: DecisionKind;
};

export type PositionStatus = "OPEN" | "SHADOW" | "CLOSED";

export type Position = {
  planId: string;
  coin: SymbolId;
  entry: number;
  initialStop: number;
  stop: number;
  size: number;
  riskUsd: number;
  addNumber: number;
  openedAt: number;
  zoneTop: number;
  zoneBottom: number;
  breakeven: boolean;
  status: PositionStatus;
  exitAt?: number;
  exitPrice?: number;
  exitRule?: string;
  netPnl?: number;
  netR?: number;
  staleHoldUntil?: number | null;
};

export type JournalKind = "ENTRY" | "EXIT" | "FEE" | "SLIPPAGE" | "RESULT" | "SKIPPED";

export type JournalLine = {
  id: string;
  at: number;
  coin: SymbolId;
  planId: string;
  kind: JournalKind;
  text: string;
  r?: number;
};

export type GateAlert = { id: string; kind: "GATE"; planId: string; at: number };
export type ExitAlert = {
  id: string;
  kind: "EXIT";
  planId: string;
  rule: string;
  exitPrice: number;
  at: number;
};
export type StaleAlert = { id: string; kind: "STALE"; planId: string; at: number };
export type Alert = GateAlert | ExitAlert | StaleAlert;

export type Checks = {
  trades: boolean;
  winRate: boolean;
  expectancy: boolean;
  maxDd: boolean;
};

export type SundayReport = {
  at: number;
  trades: number;
  wins: number;
  winRate: number;
  expectancy: number;
  maxDd: number;
  pass: boolean;
  checks: Checks;
};

export type TapeLine = { at: number; seat: string; text: string };

export type Book = {
  now: number;
  balance: number;
  realBalance: number | null;
  watchlist: WatchRow[];
  zones: Zone[];
  plans: Plan[];
  rejections: Rejection[];
  decisions: Decision[];
  positions: Position[];
  journal: JournalLine[];
  alerts: Alert[];
  reports: SundayReport[];
  tape: TapeLine[];
  lastScreenAt: number | null;
  lastMapAt: number | null;
};

export type Seat = "screen" | "map" | "risk" | "gate" | "exit" | "audit" | "rules";

export type Metrics = {
  trades: number;
  wins: number;
  winRate: number;
  expectancy: number;
  maxDd: number;
  equity: number[];
  checks: Checks;
  pass: boolean;
};
