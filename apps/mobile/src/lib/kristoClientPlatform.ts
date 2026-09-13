import { Platform } from "react-native";

export const KRISTO_CLIENT_PLATFORM_HEADER =
  "x-kristo-client-platform" as const;

export function getKristoClientPlatformHeaderValue():
  | "ios"
  | "android"
  | "web"
  | "unknown" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "web") return "web";
  return "unknown";
}
