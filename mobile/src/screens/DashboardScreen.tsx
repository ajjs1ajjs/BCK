import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { api } from "../lib/api";

export default function DashboardScreen() {
  const [stats, setStats] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const data = await api.getStats();
    setStats(data);
  };

  useEffect(() => { load(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>BCK Backup Manager</Text>

      <View style={styles.grid}>
        <View style={styles.card}>
          <Text style={styles.cardValue}>{stats?.total_jobs ?? 0}</Text>
          <Text style={styles.cardLabel}>Total Jobs</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardValue}>{stats?.active_jobs ?? 0}</Text>
          <Text style={styles.cardLabel}>Active</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardValue}>{stats?.total_repositories ?? 0}</Text>
          <Text style={styles.cardLabel}>Repos</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardValue}>{stats?.recent_runs ?? 0}</Text>
          <Text style={styles.cardLabel}>24h Runs</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Storage</Text>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.min((stats?.total_storage_bytes ?? 0) / (100 * 1024 * 1024 * 1024) * 100, 100)}%` }]} />
        </View>
        <Text style={styles.barLabel}>{(stats?.total_storage_bytes ?? 0 / (1024 * 1024)).toFixed(1)} MB used</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>System Status</Text>
        <Text style={styles.status}>● Operational</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", color: "#e0e0e0", marginBottom: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 20 },
  card: {
    backgroundColor: "#16213e",
    borderRadius: 12,
    padding: 16,
    width: "46%",
    alignItems: "center",
  },
  cardValue: { fontSize: 28, fontWeight: "bold", color: "#e94560" },
  cardLabel: { fontSize: 12, color: "#888", marginTop: 4 },
  section: { backgroundColor: "#16213e", borderRadius: 12, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#e0e0e0", marginBottom: 8 },
  bar: { height: 8, backgroundColor: "#0f3460", borderRadius: 4, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: "#e94560" },
  barLabel: { fontSize: 12, color: "#888", marginTop: 4 },
  status: { fontSize: 14, color: "#4caf50" },
});
