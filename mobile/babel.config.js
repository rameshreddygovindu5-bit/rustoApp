module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Required by react-native-reanimated — MUST be listed last.
      "react-native-reanimated/plugin",
    ],
  };
};
