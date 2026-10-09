import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/desk/tick")({
  server: {
    handlers: {
      GET: async () => {
        const { advanceDesk } = await import("@/lib/desk/clock.server");
        const book = await advanceDesk();
        return Response.json({ ok: true, now: book.now, balance: book.balance });
      },
    },
  },
});
