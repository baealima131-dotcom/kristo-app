export const ENV = {
  API_BASE: process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:3000",
  WEB_BASE: process.env.EXPO_PUBLIC_WEB_BASE ?? "http://localhost:3000",
  DEMO: (process.env.EXPO_PUBLIC_DEMO ?? "0") === "1",
};
