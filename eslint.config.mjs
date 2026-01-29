import next from "eslint-config-next";

const config = [
  ...next,
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "build/**", "coverage/**", "data/**"],
  },
];

export default config;
