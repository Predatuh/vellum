import { createServerFn } from "@tanstack/react-start";

export const tickDesk = createServerFn({ method: "POST" }).handler(async () => {
  const { advanceDesk } = await import("./clock.server");
  return advanceDesk();
});
