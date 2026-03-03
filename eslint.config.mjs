import next from "eslint-config-next";

const config = [
  ...next,
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "build/**", "coverage/**", "data/**", "apps/mobile/_bak/**", "apps/mobile/.expo/**"],
  },


  /* MOBILE_OVERRIDES */
  {
    files: [
      "apps/mobile/**/*.{ts,tsx,js,jsx}",
      "**/apps/mobile/**/*.{ts,tsx,js,jsx}",
    ],
    rules: {
      // RN: no alt prop on <Image/>
      "jsx-a11y/alt-text": "off",

      // V1: don't fight deps warnings in mobile
      "react-hooks/exhaustive-deps": "off",

      // Allow default-exported objects in mobile utilities
      "import/no-anonymous-default-export": "off",

      // ✅ Relax new strict react-hooks rules for RN code (V1)
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",

      // RN screens sometimes have apostrophes in <Text>
      "react/no-unescaped-entities": "off",
    },
  },

];

export default config;
