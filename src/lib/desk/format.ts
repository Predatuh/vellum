const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtWhen(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getUTCDay()]} ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtPx(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (abs >= 100) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(3);
  if (abs >= 0.1) return n.toFixed(4);
  return n.toFixed(5);
}

export function fmtUsd(n: number): string {
  const sign = n < 0 ? "−" : "";
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${body}`;
}

export function fmtR(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)}R`;
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export function fmtSize(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(4);
}

export function fmtImpulse(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
