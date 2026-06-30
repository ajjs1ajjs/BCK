import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import DashboardScreen from "./screens/DashboardScreen";
import JobsScreen from "./screens/JobsScreen";
import AlertsScreen from "./screens/AlertsScreen";
import SettingsScreen from "./screens/SettingsScreen";

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="auto" />
        <Tab.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: "#1a1a2e" },
            headerTintColor: "#e0e0e0",
            tabBarStyle: { backgroundColor: "#16213e", borderTopColor: "#0f3460" },
            tabBarActiveTintColor: "#e94560",
            tabBarInactiveTintColor: "#888",
          }}
        >
          <Tab.Screen
            name="Dashboard"
            component={DashboardScreen}
            options={{ tabBarLabel: "Home", tabBarIcon: () => <Text>📊</Text> }}
          />
          <Tab.Screen
            name="Jobs"
            component={JobsScreen}
            options={{ tabBarLabel: "Jobs", tabBarIcon: () => <Text>📁</Text> }}
          />
          <Tab.Screen
            name="Alerts"
            component={AlertsScreen}
            options={{ tabBarLabel: "Alerts", tabBarIcon: () => <Text>🔔</Text> }}
          />
          <Tab.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ tabBarLabel: "Settings", tabBarIcon: () => <Text>⚙️</Text> }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
