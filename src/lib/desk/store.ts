import { create } from "zustand";
import { persist } from "zustand/middleware";
import { answer, blankBook, catchUp, openLive, setRealBalance } from "./engine";
import { fetchKlines } from "./live";
import { HOUR } from "./market";
import { candleTape, setCandleTape } from "./tape";
import type { Book, Candle, Seat, SymbolId } from "./types";

const TAPE_VERSION = 3;

type Persisted = { book?: Book; seat?: Seat; v?: number };
type Feed = "loading" | "live" | "error";

type DeskStore = {
  book: Book;
  seat: Seat;
  feed: Feed;
  feedNote: string;
  checkedAt: number | null;
  sync: () => Promise<void>;
  respond: (id: string, choice: "TAKEN" | "SKIPPED" | "CLOSED" | "HOLD") => void;
  setSeat: (seat: Seat) => void;
  setReal: (value: number | null) => void;
  reset: () => void;
};

const announced = new Set<string>();
let syncing = false;
let primed = false;

function mergeTape(incoming: Record<SymbolId, Candle[]>): Record<SymbolId, Candle[]> {
  const prev = candleTape();
  const next = {} as Record<SymbolId, Candle[]>;
  for (const coin of Object.keys(incoming) as SymbolId[]) {
    const map = new Map<number, Candle>();
    for (const candle of prev[coin] ?? []) map.set(candle.t, candle);
    for (const candle of incoming[coin] ?? []) map.set(candle.t, candle);
    next[coin] = [...map.values()].sort((a, b) => a.t - b.t);
  }
  return next;
}

function announce(book: Book) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  for (const alert of book.alerts) {
    if (announced.has(alert.id)) continue;
    announced.add(alert.id);
    const plan = book.plans.find((item) => item.id === alert.planId);
    const pos = book.positions.find((item) => item.planId === alert.planId);
    const coin = plan?.coin ?? pos?.coin ?? "Desk";
    const title =
      alert.kind === "EXIT" ? `Exit now · ${coin}` : alert.kind === "STALE" ? `Stale · ${coin}` : `Short ${coin}`;
    const body =
      alert.kind === "GATE" && plan
        ? `Sell ${plan.entry.toFixed(2)}. Stop ${plan.stop.toFixed(2)}.`
        : alert.kind === "EXIT"
          ? alert.rule
          : "Flat for 72 hours. Hold it or close it.";
    try {
      new Notification(title, { body, tag: alert.id });
    } catch {
      /* the page can still show the slip */
    }
  }
}

export function replayAlerts() {
  for (const alert of useDesk.getState().book.alerts) announced.delete(alert.id);
  announce(useDesk.getState().book);
}

export const useDesk = create<DeskStore>()(
  persist(
    (set, get) => ({
      book: blankBook(),
      seat: "map",
      feed: "loading",
      feedNote: "",
      checkedAt: null,
      sync: async () => {
        if (syncing) return;
        syncing = true;
        try {
          const live = await fetchKlines({ data: { recent: primed } });
          setCandleTape(primed ? mergeTape(live.candles) : live.candles);
          primed = true;
          const current = get().book;
          const aligned = current.now > 0 && Math.abs(live.asOf - current.now) <= 72 * HOUR;
          const book = aligned ? catchUp(current, live.asOf) : openLive(live.asOf);
          set({ book, feed: "live", feedNote: "", checkedAt: Date.now() });
          announce(book);
        } catch {
          set({ feed: "error", feedNote: "Coinbase did not answer. The book is unchanged." });
        } finally {
          syncing = false;
        }
      },
      respond: (id, choice) => {
        const book = answer(get().book, id, choice);
        set({ book });
        void get().sync();
      },
      setSeat: (seat) => set({ seat }),
      setReal: (value) => set({ book: setRealBalance(get().book, value) }),
      reset: () => {
        announced.clear();
        primed = false;
        set({ book: blankBook(), seat: "map", feed: "loading", feedNote: "" });
        void get().sync();
      },
    }),
    {
      name: "vellum-desk-v3",
      skipHydration: true,
      partialize: (state) => ({ book: state.book, seat: state.seat, v: TAPE_VERSION }),
      merge: (persisted, current) => {
        const saved = persisted as Persisted;
        if (!saved || saved.v !== TAPE_VERSION || !saved.book || saved.book.now <= 0) return current;
        return { ...current, book: saved.book, seat: saved.seat ?? current.seat };
      },
    },
  ),
);
