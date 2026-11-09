// CallKit / PushKit are iOS-only here; Android keeps its own call service (notifee), so these
// packages are not linked into the Android app.
module.exports = {
  dependencies: {
    "react-native-callkeep": { platforms: { android: null } },
    "react-native-voip-push-notification": { platforms: { android: null } },
  },
};
