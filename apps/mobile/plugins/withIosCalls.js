const fs = require("fs");
const path = require("path");
const { withDangerousMod, withEntitlementsPlist, withInfoPlist } = require("@expo/config-plugins");

/**
 * iOS calls.
 * - Always: the "audio" background mode, so an answered call (reported to CallKit) keeps its
 *   microphone and connection with the screen locked or the app in the background.
 * - With KRISTO_IOS_VOIP_PUSH=1 only (needs the Push Notifications capability in the App Store
 *   provisioning profile and an APNs key on the server): the "voip" background mode, the push
 *   entitlement and PushKit in AppDelegate, which reports each VoIP push to CallKit as an
 *   incoming call (react-native-voip-push-notification + react-native-callkeep).
 */
const VOIP_PUSH = process.env.KRISTO_IOS_VOIP_PUSH === "1";
const MARKER = "// Kristo: VoIP pushes (PushKit) for incoming calls.";

const APPDELEGATE_EXTENSION = `
${MARKER} iOS requires every VoIP push to be reported to
// CallKit right away, so the incoming call is reported here, before JS runs.
extension AppDelegate: PKPushRegistryDelegate {
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    RNVoipPushNotificationManager.didUpdate(pushCredentials, forType: type.rawValue)
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {}

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let data = payload.dictionaryPayload
    let callUuid = (data["callUuid"] as? String) ?? UUID().uuidString.lowercased()
    let callId = (data["callId"] as? String) ?? ""
    let callerName = (data["callerName"] as? String) ?? "Kristo"
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)
    RNCallKeep.reportNewIncomingCall(
      callUuid,
      handle: callId,
      handleType: "generic",
      hasVideo: false,
      localizedCallerName: callerName,
      supportsHolding: false,
      supportsDTMF: false,
      supportsGrouping: false,
      supportsUngrouping: false,
      fromPushKit: true,
      payload: data,
      withCompletionHandler: completion
    )
  }
}
`;

function patchAppDelegate(source) {
  if (source.includes(MARKER)) return source;
  let next = source.replace(/^import Expo$/m, "import Expo\nimport PushKit");
  const returnLine = "return super.application(application, didFinishLaunchingWithOptions: launchOptions)";
  if (!next.includes("import PushKit") || !next.includes(returnLine)) {
    throw new Error("withIosCalls: AppDelegate.swift does not match the expected Expo template");
  }
  next = next.replace(returnLine, `RNVoipPushNotificationManager.voipRegistration()\n    ${returnLine}`);
  return `${next.trimEnd()}\n${APPDELEGATE_EXTENSION}`;
}

function patchBridgingHeader(source) {
  const imports = ['#import <RNVoipPushNotification/RNVoipPushNotificationManager.h>', "#import <RNCallKeep/RNCallKeep.h>"];
  const missing = imports.filter((line) => !source.includes(line));
  return missing.length ? `${source.trimEnd()}\n${missing.join("\n")}\n` : source;
}

function withVoipPushAppDelegate(config) {
  return withDangerousMod(config, [
    "ios",
    (configMod) => {
      const projectDir = path.join(configMod.modRequest.platformProjectRoot, configMod.modRequest.projectName);
      const appDelegatePath = path.join(projectDir, "AppDelegate.swift");
      fs.writeFileSync(appDelegatePath, patchAppDelegate(fs.readFileSync(appDelegatePath, "utf8")));
      const header = fs.readdirSync(projectDir).find((name) => name.endsWith("-Bridging-Header.h"));
      if (!header) throw new Error("withIosCalls: no Swift bridging header found");
      const headerPath = path.join(projectDir, header);
      fs.writeFileSync(headerPath, patchBridgingHeader(fs.readFileSync(headerPath, "utf8")));
      return configMod;
    },
  ]);
}

module.exports = function withIosCalls(config) {
  config = withInfoPlist(config, (configMod) => {
    const modes = new Set(
      Array.isArray(configMod.modResults.UIBackgroundModes) ? configMod.modResults.UIBackgroundModes : []
    );
    modes.add("audio");
    if (VOIP_PUSH) modes.add("voip");
    configMod.modResults.UIBackgroundModes = [...modes];
    return configMod;
  });
  if (!VOIP_PUSH) return config;
  config = withEntitlementsPlist(config, (configMod) => {
    configMod.modResults["aps-environment"] = "production";
    return configMod;
  });
  return withVoipPushAppDelegate(config);
};

module.exports.VOIP_PUSH = VOIP_PUSH;
module.exports.patchAppDelegate = patchAppDelegate;
module.exports.patchBridgingHeader = patchBridgingHeader;
