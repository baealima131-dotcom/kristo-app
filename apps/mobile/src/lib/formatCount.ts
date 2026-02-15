export function formatCount(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  if (v < 1000) return String(Math.floor(v));

  const units = [
    { value: 1_000_000_000, suffix: "B" },
    { value: 1_000_000, suffix: "M" },
    { value: 1_000, suffix: "K" },
  ];

  for (const u of units) {
    if (v >= u.value) {
      const raw = v / u.value;
      // keep 1 decimal only when needed (1.0K -> 1K)
      const s = raw >= 10 ? raw.toFixed(0) : raw.toFixed(1);
      return s.replace(/\.0$/, "") + u.suffix;
    }
  }

  return String(Math.floor(v));
}
