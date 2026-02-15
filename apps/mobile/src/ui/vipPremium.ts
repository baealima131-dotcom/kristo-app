export const VIP = {
  colors: {
    bg: "#0B0F17",
    text: "#FFFFFF",
    mut: "rgba(255,255,255,0.72)",
    line: "rgba(255,255,255,0.14)",
    glass: "rgba(255,255,255,0.06)",
    gold: "#D9B35F",
    gold2: "#F4D488",
  },
  radius: {
    btn: 16,
    card: 18,
    chip: 999,
  },
};

export const VIP_TYPE = {
  h1: { fontSize: 22, fontWeight: "900" as const, letterSpacing: 0.2, color: VIP.colors.text },
  h2: { fontSize: 18, fontWeight: "900" as const, letterSpacing: 0.15, color: VIP.colors.text },
  body: { fontSize: 15, fontWeight: "700" as const, letterSpacing: 0.1, color: VIP.colors.text },
  mut: { fontSize: 13, fontWeight: "700" as const, color: VIP.colors.mut },
};
