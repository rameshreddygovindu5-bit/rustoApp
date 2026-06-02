import React from "react";
import { Tabs } from "expo-router";
import { Home, Search, User } from "lucide-react-native";
import { colors } from "@/theme";

/**
 * Bottom tab bar — Home / Search / Account. Same three primary
 * destinations as the web's RustoLayout top nav, just relocated
 * to the bottom for thumb-friendliness on mobile.
 */
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.ink400,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.ink100,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          letterSpacing: 0.3,
        },
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: { color: colors.navy, fontWeight: "700" },
        headerShadowVisible: false,
      }}>
      <Tabs.Screen name="index"
                    options={{
                      title: "Home",
                      tabBarIcon: ({ color, size }) => <Home size={size} color={color}/>,
                      headerShown: false,  // home has its own immersive hero
                    }}/>
      <Tabs.Screen name="search"
                    options={{
                      title: "Search",
                      tabBarIcon: ({ color, size }) => <Search size={size} color={color}/>,
                    }}/>
      <Tabs.Screen name="account"
                    options={{
                      title: "Account",
                      tabBarIcon: ({ color, size }) => <User size={size} color={color}/>,
                    }}/>
    </Tabs>
  );
}
