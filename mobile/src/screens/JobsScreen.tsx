import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from "react-native";
import { api } from "../lib/api";

export default function JobsScreen() {
  const [jobs, setJobs] = useState<any[]>([]);

  useEffect(() => { api.listJobs().then(setJobs); }, []);

  return (
    <View style={styles.container}>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.jobCard}
            onPress={() => Alert.alert(item.name, `Source: ${item.source_path}\nCron: ${item.cron_expression || "Manual"}`)}
          >
            <View style={styles.jobHeader}>
              <Text style={styles.jobName}>{item.name}</Text>
              <View style={[styles.badge, { backgroundColor: item.status === "active" ? "#4caf50" : "#ff9800" }]}>
                <Text style={styles.badgeText}>{item.status}</Text>
              </View>
            </View>
            <Text style={styles.jobPath}>{item.source_path}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", padding: 16 },
  jobCard: { backgroundColor: "#16213e", borderRadius: 12, padding: 14, marginBottom: 10 },
  jobHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  jobName: { fontSize: 16, fontWeight: "600", color: "#e0e0e0" },
  jobPath: { fontSize: 12, color: "#888", marginTop: 4 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, color: "#fff", fontWeight: "600" },
});
