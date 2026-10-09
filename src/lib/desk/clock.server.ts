import { openLive, runAuto } from "./engine";
import { loadCandles } from "./live";
import { HOUR } from "./market";
import { setCandleTape } from "./tape";
import type { Book } from "./types";

function asBook(value: unknown): Book | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Book;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  return value as Book;
}

async function readRow(): Promise<{ book: Book; updatedAt: number } | null> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql.query<{ book: unknown; updated_at: string | Date }>(
    "select book, updated_at from desk_book where id = 1",
  );
  const row = rows[0];
  if (!row) return null;
  const book = asBook(row.book);
  if (!book) return null;
  const updatedAt = new Date(row.updated_at).getTime();
  return { book, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 };
}

async function writeBook(book: Book): Promise<void> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  await sql.query(
    `insert into desk_book (id, book, updated_at)
     values (1, $1::jsonb, now())
     on conflict (id) do update set book = excluded.book, updated_at = now()`,
    [JSON.stringify(book)],
  );
}

let pending: Promise<Book> | null = null;

export async function advanceDesk(): Promise<Book> {
  if (pending) return pending;
  pending = advance().finally(() => {
    pending = null;
  });
  return pending;
}

async function advance(): Promise<Book> {
  const saved = await readRow();
  const closedHour = Math.floor(Date.now() / HOUR) * HOUR;
  if (saved && saved.book.now >= closedHour) return saved.book;
  const live = await loadCandles(false);
  setCandleTape(live.candles);
  const start = saved?.book.now ? saved.book : openLive(live.asOf);
  const book = runAuto(start, live.asOf);
  await writeBook(book);
  return book;
}
