import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider } from "@/context/AuthContext";
import { ErrorBoundary } from "@/components/UI";
import { colors } from "@/theme";

// Keep the splash screen visible while we're loading auth state.
SplashScreen.preventAutoHideAsync().catch(() => {/* ok if already hidden */});

export default function RootLayout() {
  useEffect(() => {
    // Hide splash once the root layout has mounted.
    // AuthProvider handles hiding it after token check completes.
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 1000);
    return () => clearTimeout(t);
  }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <StatusBar style="light"/>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.white },
              headerTintColor: colors.navy,
              headerTitleStyle: { fontWeight: "700" },
              contentStyle: { backgroundColor: colors.ink50 },
              animation: "slide_from_right",
            }}>
            <Stack.Screen name="(tabs)"               options={{ headerShown: false }}/>
            <Stack.Screen name="signin"               options={{ title: "Sign in",        presentation: "card" }}/>
            <Stack.Screen name="signup"               options={{ title: "Create account", presentation: "card" }}/>
            <Stack.Screen name="lodges/[code]"        options={{ title: "", headerTransparent: true, headerStyle: { backgroundColor: "transparent" }, headerTintColor: colors.white }}/>
            <Stack.Screen name="checkout/[bookingId]" options={{ title: "Checkout",       presentation: "card" }}/>
            <Stack.Screen name="wishlist"             options={{ title: "My Wishlist" }}/>
            <Stack.Screen name="membership"           options={{ title: "Membership" }}/>
            <Stack.Screen name="edit-profile"         options={{ title: "Edit Profile" }}/>
            <Stack.Screen name="my-reviews"           options={{ title: "My Reviews" }}/>
          </Stack>
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
