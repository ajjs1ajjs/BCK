import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function AlertsScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.empty}>
        <Text style={styles.icon}>🔔</Text>
        <Text style={styles.title}>No Alerts</Text>
        <Text style={styles.subtitle}>Push notifications about backup jobs will appear here</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", padding: 16 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center" },
  icon: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: "600", color: "#e0e0e0", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#888", textAlign: "center" },
});
