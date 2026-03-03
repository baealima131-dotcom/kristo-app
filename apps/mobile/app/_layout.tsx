import "react-native-gesture-handler";

import { Slot } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KristoSessionProvider } from "@/src/lib/KristoSessionProvider";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KristoSessionProvider>
        <Slot />
      </KristoSessionProvider>
    </GestureHandlerRootView>
  );
}
