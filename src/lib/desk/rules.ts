/** Locked desk rules. The auditor may score them. Nothing in the UI may edit them. */
export const RULES = {
  riskPct: 0.005,
  impulseMin: 0.08,
  anchorDays: 14,
  lowFreshDays: 3,
  targetR: 2,
  beR: 1,
  staleHours: 72,
  staleBandR: 0.25,
  feeBps: 4,
  slipBps: 2,
  startingBalance: 10_000,
  minGap: 0.004,
  thresholds: {
    trades: 40,
    winRate: 0.33,
    expectancy: 0.4,
    maxDd: 0.2,
  },
} as const;
