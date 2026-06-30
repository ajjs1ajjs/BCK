import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from "react-native";
import { login } from "../lib/api";

export default function SettingsScreen() {
  const [server, setServer] = useState("http://localhost:8080/api/v1");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    const ok = await login(username, password);
    if (ok) Alert.alert("Success", "Logged in successfully");
    else Alert.alert("Error", "Login failed");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Server URL</Text>
        <TextInput style={styles.input} value={server} onChangeText={setServer} placeholder="http://..." placeholderTextColor="#555" />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Login</Text>
        <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor="#555" />
        <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor="#555" secureTextEntry />
        <TouchableOpacity style={styles.button} onPress={handleLogin}>
          <Text style={styles.buttonText}>Connect</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>About</Text>
        <Text style={styles.text}>BCK Mobile v1.0.0</Text>
        <Text style={styles.text}>Backup Manager Client</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", color: "#e0e0e0", marginBottom: 16 },
  card: { backgroundColor: "#16213e", borderRadius: 12, padding: 16, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: "600", color: "#e0e0e0", marginBottom: 8 },
  input: { backgroundColor: "#0f3460", borderRadius: 8, padding: 12, color: "#e0e0e0", marginBottom: 8, fontSize: 14 },
  button: { backgroundColor: "#e94560", borderRadius: 8, padding: 12, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  text: { color: "#888", fontSize: 13, marginTop: 2 },
});
