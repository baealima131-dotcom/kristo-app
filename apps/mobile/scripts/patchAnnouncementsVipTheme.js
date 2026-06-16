const fs = require("fs");

const f = "app/(tabs)/more/my-church-room/announcements/index.tsx";
let s = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");

// Ensure vipTheme import exists
if (!s.includes('from "@/src/ui/vipTheme"')) {
  s = s.replace(
    /import\s+\{\s*SafeAreaView\s*\}\s+from\s+"react-native-safe-area-context";\n/,
    (m) => m + `import { VIP_COLORS, VIP_SPACING, VIP_RADIUS, VIP_TYPOGRAPHY, vipShadow } from "@/src/ui/vipTheme";\n`
  );
}

// Remove old C block if present
s = s.replace(/\nconst C = \{\n[\s\S]*?\n\};\n/, "\n");

// Replace C.* references -> VIP
const reps = [
  ["C.bg", "VIP_COLORS.bg"],
  ["C.glass2", "VIP_COLORS.glassBg"],
  ["C.glass", "VIP_COLORS.glassBg"],
  ["C.borderSoft", "VIP_COLORS.glassBorder"],
  ["C.border", "VIP_COLORS.glassBorder"],
  ["C.gold", "VIP_COLORS.gold"],
  ["C.text.primary", "VIP_COLORS.text.primary"],
  ["C.text.secondary", "VIP_COLORS.text.secondary"],
  ["C.text.muted", "VIP_COLORS.text.muted"],
  // NOTE: C.bad was used; keep as string not function
  ["C.bad", '"rgba(255,90,90,0.95)"'],
];
for (const [a, b] of reps) s = s.split(a).join(b);

// Safer spacing/radius tweaks
s = s.replace(/paddingHorizontal:\s*14/g, "paddingHorizontal: VIP_SPACING.outer");
s = s.replace(/padding:\s*12/g, "padding: VIP_SPACING.cardPadding");
s = s.replace(/borderRadius:\s*20/g, "borderRadius: VIP_RADIUS.card");
s = s.replace(/borderRadius:\s*18/g, "borderRadius: VIP_RADIUS.inner");

// Add vipShadow into card block safely (no comma bugs)
// We insert before the closing "}," of card if not already there.
s = s.replace(
  /card:\s*\{([\s\S]*?)\n\s*\},/m,
  (m, inner) => {
    if (m.includes("...vipShadow")) return m;
    // ensure inner doesn't end with a trailing comma weirdness
    let fixed = inner.replace(/,,/g, ",");
    fixed = fixed.replace(/overflow:\s*"hidden",\s*,/g, 'overflow: "hidden",');
    return `card: {${fixed}\n    ...vipShadow,\n  },`;
  }
);

// FINAL SANITIZE: never leave double commas
s = s.replace(/overflow:\s*"hidden",\s*,/g, 'overflow: "hidden",');
s = s.replace(/,,/g, ",");

// Guard: NEVER touch the ann id template. If broken, fix it.
s = s.replace(/id:\s*`ann_\$\{Date\.now\(\)[^`]*`\,/g, "id: `ann_${Date.now()}`,");

fs.writeFileSync(f, s, "utf8");
console.log("SAFE PATCH DONE:", f);
