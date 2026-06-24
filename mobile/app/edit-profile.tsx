import React, { useState } from "react";
import {
  ScrollView, View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { colors, spacing } from "@/theme";
import { Button, Card, Input, Loading } from "@/components/UI";
import { errorMessage } from "@/lib/format";

/**
 * Edit Profile screen — update name, email, city, state, pincode.
 * Change password is a separate section.
 */
export default function EditProfile() {
  const { customer, updateProfile, changePassword, loading: authLoading } = useAuth();
  const router = useRouter();

  const [form, setForm] = useState({
    full_name: customer?.full_name ?? "",
    email:     customer?.email     ?? "",
    city:      customer?.city      ?? "",
    state:     customer?.state     ?? "",
    pincode:   customer?.pincode   ?? "",
  });
  const [busy, setBusy] = useState(false);

  const [pwdForm, setPwdForm] = useState({
    current_password: "",
    new_password:     "",
    confirm_password: "",
  });
  const [pwdBusy, setPwdBusy] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const setPwd = (k: keyof typeof pwdForm, v: string) => setPwdForm(f => ({ ...f, [k]: v }));

  if (authLoading) return <Loading message="Loading..."/>;

  const saveProfile = async () => {
    if (form.full_name.trim().length < 2) {
      return Alert.alert("Full name must be at least 2 characters");
    }
    setBusy(true);
    try {
      await updateProfile({
        full_name: form.full_name.trim(),
        email:     form.email.trim() || undefined,
        city:      form.city.trim()  || undefined,
        state:     form.state.trim() || undefined,
        pincode:   form.pincode.trim() || undefined,
      } as any);
      Alert.alert("Profile updated", "", [{ text: "OK", onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert("Update failed", errorMessage(e));
    } finally { setBusy(false); }
  };

  const savePassword = async () => {
    if (!pwdForm.current_password) return Alert.alert("Enter your current password");
    if (pwdForm.new_password.length < 8) return Alert.alert("New password must be at least 8 characters");
    if (pwdForm.new_password !== pwdForm.confirm_password) return Alert.alert("Passwords do not match");
    setPwdBusy(true);
    try {
      await changePassword({
        current_password: pwdForm.current_password,
        new_password:     pwdForm.new_password,
      });
      setPwdForm({ current_password: "", new_password: "", confirm_password: "" });
      Alert.alert("Password changed successfully");
    } catch (e) {
      Alert.alert("Failed to change password", errorMessage(e));
    } finally { setPwdBusy(false); }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.ink50 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.huge }}>

        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={styles.sectionTitle}>Personal details</Text>
          <Input
            label="Full name" required
            value={form.full_name}
            onChangeText={v => set("full_name", v)}
            autoCapitalize="words"
          />
          <Input
            label="Email (optional)"
            value={form.email}
            onChangeText={v => set("email", v)}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="you@example.com"
          />
          <Input
            label="City"
            value={form.city}
            onChangeText={v => set("city", v)}
            autoCapitalize="words"
          />
          <Input
            label="State"
            value={form.state}
            onChangeText={v => set("state", v)}
            autoCapitalize="words"
          />
          <Input
            label="PIN code"
            value={form.pincode}
            onChangeText={v => set("pincode", v)}
            keyboardType="numeric"
            maxLength={6}
          />
          <Button title="Save changes" variant="gold" fullWidth loading={busy} onPress={saveProfile}/>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Change password</Text>
          <Input
            label="Current password" required
            value={pwdForm.current_password}
            onChangeText={v => setPwd("current_password", v)}
            secureTextEntry
            placeholder="Your current password"
          />
          <Input
            label="New password" required
            value={pwdForm.new_password}
            onChangeText={v => setPwd("new_password", v)}
            secureTextEntry
            placeholder="Min 8 characters"
            hint="At least 8 characters"
          />
          <Input
            label="Confirm new password" required
            value={pwdForm.confirm_password}
            onChangeText={v => setPwd("confirm_password", v)}
            secureTextEntry
            placeholder="Repeat new password"
          />
          <Button title="Change password" variant="primary" fullWidth loading={pwdBusy} onPress={savePassword}/>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 17, fontWeight: "700", color: colors.navy, marginBottom: spacing.lg },
});
