/**
 * Tab layout — "Indian Dusk" design v2
 *
 * Three tabs on the bottom:
 *   Home     — Customer booking portal (explore lodges, search, book)
 *   Search   — Search results
 *   Account  — Profile, bookings, wishlist
 *
 * The visual design makes it immediately clear this is the CUSTOMER
 * booking app (not the lodge management app). Lodge management is a
 * separate authenticated PMS web interface.
 */
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Tabs } from "expo-router";
import { Home, Search, User } from "lucide-react-native";
import { colors } from "@/theme";
import { useAuth } from "@/context/AuthContext";
import { rustoBookings } from "@/api/rusto";

/** Badge showing payment_pending count on Account tab. */
function AccountBadge() {
  const { customer } = useAuth();
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!customer) { setPending(0); return; }
    rustoBookings.list()
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : (r.data as any).bookings ?? [];
        setPending(list.filter((b: any) => b.status === "payment_pending").length);
      })
      .catch(() => {});
  }, [customer]);
  if (!pending) return null;
  return (
    <View style={{
      position: "absolute", top: -3, right: -6,
      backgroundColor: colors.terracotta, borderRadius: 8,
      minWidth: 16, height: 16, paddingHorizontal: 3,
      justifyContent: "center", alignItems: "center",
    }}>
      <Text style={{ color: "white", fontSize: 9, fontWeight: "700" }}>{pending}</Text>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor:   colors.gold,
        tabBarInactiveTintColor: colors.ink400,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor:  colors.ink100,
          borderTopWidth:  1,
          height:          64,
          paddingBottom:   12,
          paddingTop:      8,
          // Subtle lift shadow
          shadowColor:     "#0D1F2D",
          shadowOffset:    { width: 0, height: -2 },
          shadowOpacity:   0.06,
          shadowRadius:    8,
          elevation:       8,
        },
        tabBarLabelStyle: {
          fontSize: 10, fontWeight: "700", letterSpacing: 0.2,
        },
        headerStyle:         { backgroundColor: colors.white },
        headerTitleStyle:    { color: colors.navy, fontWeight: "800" },
        headerShadowVisible: false,
      }}>

      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Home size={size} color={color}/>,
        }}/>

      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, size }) => <Search size={size} color={color}/>,
          headerTitle: "Find a Lodge",
        }}/>

      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          headerTitle: "My Account",
          tabBarIcon: ({ color, size }) => (
            <View>
              <User size={size} color={color}/>
              <AccountBadge/>
            </View>
          ),
        }}/>
    </Tabs>
  );
}
