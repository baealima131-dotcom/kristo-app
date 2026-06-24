import React from "react";
import { Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function ModalScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Kristo App" }} />
      <View style={styles.container}>
        <Text style={styles.title}>Kristo App</Text>
        <Text style={styles.message}>Welcome.</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#0B0618" },
  title: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginBottom: 8 },
  message: { color: "#C9BDF5", fontSize: 15 },
});
