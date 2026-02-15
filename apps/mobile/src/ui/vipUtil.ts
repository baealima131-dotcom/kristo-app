export function vipInitials(name: string) {
  const s = (name || "").trim();
  if (!s) return "U";
  const parts = s.split(/\s+/g).slice(0, 2);
  const out = parts.map((p) => (p[0] || "").toUpperCase()).join("");
  return out || "U";
}

export function vipAvatarBg(seed: string) {
  const str = seed || "seed";
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsla(${hue}, 60%, 38%, 0.35)`;
}
