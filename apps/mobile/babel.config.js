module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          // RN 0.81 ships Flow sources with #private fields; Hermes bytecode still rejects them.
          // hermes-v0 runs private-field transforms after TS/Flow stripping (unlike hermes-v1).
          unstable_transformProfile: "hermes-v0",
        },
      ],
    ],
    plugins: [
      [
        "module-resolver",
        {
          root: ["."],
          alias: {
            "@": ".",
            "@/src": "./src",
            "@src": "./src"
          },
          extensions: [".js", ".jsx", ".ts", ".tsx", ".json"]
        }
      ]
    ],
  };
};
