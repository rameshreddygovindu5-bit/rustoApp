module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Resolve @/* imports to ./src/* — matches tsconfig.json paths.
      // Metro needs this to bundle correctly on physical devices via Expo Go.
      [
        "module-resolver",
        {
          root: ["./src"],
          extensions: [".ios.js", ".android.js", ".js", ".ts", ".tsx", ".json"],
          alias: {
            "@": "./src",
          },
        },
      ],
      // Required by react-native-reanimated — MUST be listed last.
      "react-native-reanimated/plugin",
    ],
  };
};
