const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver = {
  ...config.resolver,
  useWatchman: false,
};

config.watcher = {
  ...config.watcher,
  useWatchman: false,
};

module.exports = config;
