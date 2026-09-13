const BLOCKED = /(secret|token|address|street|phone|email|cashtag|clientsecret|authorization|password|key)/i;

export function sokoCheckoutTimer(route: string) {
  const started = Date.now();
  let last = started;

  return {
    stage(stage: string, extra: Record<string, unknown> = {}) {
      const now = Date.now();
      const safe: Record<string, unknown> = {
        route,
        stage,
        ms: now - last,
        totalMs: now - started,
      };

      for (const [key, value] of Object.entries(extra)) {
        if (BLOCKED.test(key)) continue;
        if (typeof value === "string") {
          if (BLOCKED.test(value) || value.length > 80) continue;
          safe[key] = value;
          continue;
        }
        if (
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          safe[key] = value;
        }
      }

      console.log("KRISTO_SOKO_CHECKOUT_TIMING", safe);
      last = now;
    },
  };
}
