import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/context/AuthContext";
import { colors } from "@/theme";

/**
 * Root layout for expo-router. Wraps every screen in:
 *   - SafeAreaProvider — gives child screens access to notch/home-indicator insets
 *   - AuthProvider     — customer JWT hydration + login/logout
 *   - StatusBar        — light icons over our navy hero gradients
 *
 * The Stack navigator handles modal/push transitions; screens under
 * `(tabs)/*` get the bottom tab bar from `app/(tabs)/_layout.tsx`.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light"/>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.white },
            headerTintColor: colors.navy,
            headerTitleStyle: { fontWeight: "700" },
            contentStyle: { backgroundColor: colors.ink50 },
          }}>
          {/* Tab group — no header here; tabs file owns its own UI */}
          <Stack.Screen name="(tabs)" options={{ headerShown: false }}/>

          {/* Auth */}
          <Stack.Screen name="signin" options={{ title: "Sign in" }}/>
          <Stack.Screen name="signup" options={{ title: "Create account" }}/>

          {/* Lodge detail — back from tabs */}
          <Stack.Screen name="lodges/[code]" options={{ title: "" }}/>

          {/* Checkout — modal feel */}
          <Stack.Screen name="checkout/[bookingId]"
                         options={{ title: "Checkout", presentation: "card" }}/>
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
