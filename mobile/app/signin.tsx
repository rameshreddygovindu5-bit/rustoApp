import React, { useState } from "react";
import { View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter, useLocalSearchParams, Link } from "expo-router";
import { Sparkles } from "lucide-react-native";
import { useAuth } from "@/context/AuthContext";
import { colors, spacing, shadows } from "@/theme";
import { Button, Input } from "@/components/UI";
import { errorMessage } from "@/lib/format";

/**
 * Sign-in screen — phone + password. Honours `?next=` so the lodge-detail
 * "Book now" flow can deep-link back after auth.
 */
export default function SignIn() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams();
  const next = (params.next as string) || "/(tabs)/account";

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!phone.trim() || !password) {
      Alert.alert("Phone and password are required"); return;
    }
    setBusy(true);
    try {
      await login({ phone: phone.trim(), password });
      router.replace(next as any);
    } catch (e) {
      Alert.alert("Sign in failed", errorMessage(e, "Check your phone and password"));
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.ink50 }}
                           behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <Sparkles size={20} color={colors.navyDark}/>
          </View>
        </View>
        <Text style={styles.heading}>Welcome back</Text>
        <Text style={styles.sub}>Sign in to your Rusto account</Text>

        <View style={styles.card}>
          <Input label="Phone" required value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  placeholder="9123456789"/>
          <Input label="Password" required value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="Enter your password"/>
          <Button title="Sign in" variant="gold" fullWidth loading={busy} onPress={submit}/>
        </View>

        <View style={styles.footerRow}>
          <Text style={{ color: colors.ink600 }}>New to Rusto? </Text>
          <Link href={`/signup${params.next ? `?next=${encodeURIComponent(next)}` : ""}` as any} asChild>
            <Pressable><Text style={styles.link}>Create an account</Text></Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.xl, justifyContent: "center" },
  brand: { alignItems: "center", marginBottom: spacing.lg },
  brandMark: {
    width: 56, height: 56, borderRadius: 18,
    backgroundColor: colors.gold,
    justifyContent: "center", alignItems: "center",
    ...shadows.gold,
  },
  heading: { fontSize: 28, fontWeight: "700", color: colors.navy, textAlign: "center", letterSpacing: -0.5 },
  sub: { fontSize: 14, color: colors.ink500, textAlign: "center", marginTop: 4, marginBottom: spacing.xl },
  card: {
    backgroundColor: colors.white, borderRadius: 16, padding: spacing.xl,
    ...shadows.card,
  },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: spacing.xl },
  link: { color: colors.goldDark, fontWeight: "700" },
});
