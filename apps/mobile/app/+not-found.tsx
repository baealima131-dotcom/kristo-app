import React from "react";
import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not Found" }} />
      <View style={styles.container}>
        <Text style={styles.title}>Screen not found</Text>
        <Link href="/" style={styles.link}>Go home</Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#0B0618" },
  title: { color: "#FFFFFF", fontSize: 22, fontWeight: "800", marginBottom: 16 },
  link: { color: "#D8B45F", fontSize: 16, fontWeight: "700" },
});
