// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Resolve @/* aliases to ./src/*
// This makes Metro bundler aware of the same tsconfig.json paths
// so that imports like "@/api/rusto" resolve to "./src/api/rusto".
config.resolver.extraNodeModules = {
  "@": path.resolve(__dirname, "src"),
};

module.exports = config;
