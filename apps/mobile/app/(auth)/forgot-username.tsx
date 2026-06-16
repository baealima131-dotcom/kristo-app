import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";

export default function ForgotUsername() {
  const router = useRouter();
  const [email, setEmail] = useState("");

  const handleFind = () => {
    if (!email) {
      Alert.alert("Error", "Enter your email");
      return;
    }

    if (email === "demo@kristo.app") {
      Alert.alert(
        "Account found",
        "Username: de****pp\nEmail: demo@kristo.app"
      );
    } else {
      Alert.alert(
        "Check your email",
        "If account exists, details will be sent."
      );
    }
  };

  return (
    <View style={s.container}>
      <Text style={s.title}>Find your account</Text>

      <Text style={s.label}>Email</Text>
      <TextInput
        style={s.input}
        placeholder="Enter your email"
        placeholderTextColor="rgba(255,255,255,0.4)"
        value={email}
        onChangeText={setEmail}
      />

      <Pressable style={s.btn} onPress={handleFind}>
        <Text style={s.btnText}>Find my account</Text>
      </Pressable>

      <Pressable onPress={() => router.replace("/(auth)/login")}>
        <Text style={s.back}>Back to login</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F17",
    padding: 20,
    justifyContent: "center",
  },
  title: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "900",
    marginBottom: 20,
  },
  label: {
    color: "#fff",
    marginBottom: 6,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 14,
    color: "#fff",
    marginBottom: 20,
  },
  btn: {
    backgroundColor: "#D9B35F",
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  btnText: {
    fontWeight: "900",
    color: "#000",
  },
  back: {
    color: "#aaa",
    textAlign: "center",
    marginTop: 20,
  },
});
