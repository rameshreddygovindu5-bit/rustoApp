import React, { useState } from "react";
import { View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter, useLocalSearchParams, Link } from "expo-router";
import { Sparkles } from "lucide-react-native";
import { useAuth } from "@/context/AuthContext";
import { colors, spacing, shadows } from "@/theme";
import { Button, Input } from "@/components/UI";
import { errorMessage } from "@/lib/format";

/**
 * Signup screen — full name + phone + email + password.
 *
 * 8+ char password (matches backend), no other complexity rules; the
 * backend doesn't enforce more either. Phone normalisation happens
 * server-side (strips non-digits) so we don't reject UI-friendly input.
 */
export default function SignUp() {
  const { signup } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams();
  const next = (params.next as string) || "/(tabs)/account";

  const [form, setForm] = useState({
    full_name: "", phone: "", email: "", password: "",
  });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (form.full_name.trim().length < 2) return Alert.alert("Enter your full name");
    if (form.phone.trim().length < 7)     return Alert.alert("Enter a valid phone number");
    if (form.password.length < 8)         return Alert.alert("Password must be at least 8 characters");
    setBusy(true);
    try {
      await signup({
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        password: form.password,
      });
      router.replace(next as any);
    } catch (e) {
      Alert.alert("Signup failed", errorMessage(e));
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
        <Text style={styles.heading}>Create your account</Text>
        <Text style={styles.sub}>Join Rusto to book lodges across India</Text>

        <View style={styles.card}>
          <Input label="Full name" required value={form.full_name}
                  onChangeText={v => set("full_name", v)}
                  placeholder="Arjun Mehta"
                  autoCapitalize="words"/>
          <Input label="Phone" required value={form.phone}
                  onChangeText={v => set("phone", v)}
                  keyboardType="phone-pad"
                  placeholder="9123456789"/>
          <Input label="Email (optional, for receipts)" value={form.email}
                  onChangeText={v => set("email", v)}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder="you@example.com"/>
          <Input label="Password" required value={form.password}
                  onChangeText={v => set("password", v)}
                  secureTextEntry
                  placeholder="Min 8 characters"/>
          <Button title="Create account" variant="gold" fullWidth loading={busy} onPress={submit}/>
        </View>

        <View style={styles.footerRow}>
          <Text style={{ color: colors.ink600 }}>Already on Rusto? </Text>
          <Link href={`/signin${params.next ? `?next=${encodeURIComponent(next)}` : ""}` as any} asChild>
            <Pressable><Text style={styles.link}>Sign in</Text></Pressable>
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
