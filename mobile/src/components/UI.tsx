/**
 * Shared UI primitives. Kept in one module for tight imports across screens.
 *
 *   <Button variant="primary|gold|outline|ghost"> — main CTA component
 *   <Input>           — labelled text input with optional error state
 *   <Card>            — white rounded panel with shadow
 *   <Pill>            — small inline status badge
 *   <Loading>         — centered spinner used on initial screen loads
 *   <Eyebrow>         — uppercase gold label text
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable, StyleSheet, Text, TextInput, View,
  type PressableProps, type TextInputProps, type ViewProps,
} from "react-native";
import { colors, radius, spacing, shadows, typography } from "@/theme";

// ── Button ────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "gold" | "outline" | "ghost" | "danger";

interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  small?: boolean;
}

export function Button({
  title, variant = "primary", loading, fullWidth, icon, small, disabled, ...rest
}: ButtonProps) {
  const cfg = BUTTON_STYLES[variant];
  const padV = small ? spacing.sm : spacing.md;
  const padH = small ? spacing.lg : spacing.xl;
  return (
    <Pressable
      {...rest}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn, cfg.base,
        { paddingVertical: padV, paddingHorizontal: padH },
        fullWidth && { alignSelf: "stretch" },
        (disabled || loading) && styles.btnDisabled,
        pressed && cfg.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={cfg.textColor} size="small"/>
      ) : (
        <>
          {icon && <View style={{ marginRight: spacing.sm }}>{icon}</View>}
          <Text style={[styles.btnText, { color: cfg.textColor, fontSize: small ? 13 : 15 }]}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const BUTTON_STYLES: Record<ButtonVariant,
                            { base: any; pressed: any; textColor: string }> = {
  primary: {
    base: { backgroundColor: colors.navy },
    pressed: { backgroundColor: colors.navyDark },
    textColor: colors.white,
  },
  gold: {
    base: { backgroundColor: colors.gold, ...shadows.gold },
    pressed: { backgroundColor: colors.goldDark },
    textColor: colors.navyDark,
  },
  outline: {
    base: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.ink300 },
    pressed: { backgroundColor: colors.ink50 },
    textColor: colors.navy,
  },
  ghost: {
    base: { backgroundColor: "transparent" },
    pressed: { backgroundColor: colors.ink100 },
    textColor: colors.ink700,
  },
  danger: {
    base: { backgroundColor: colors.danger },
    pressed: { backgroundColor: "#C53030" },
    textColor: colors.white,
  },
};

// ── Input ─────────────────────────────────────────────────────────

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

export function Input({ label, error, hint, required, style, ...rest }: InputProps) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label && (
        <Text style={styles.inputLabel}>
          {label}{required && <Text style={{ color: colors.danger }}> *</Text>}
        </Text>
      )}
      <TextInput
        {...rest}
        placeholderTextColor={colors.ink400}
        style={[
          styles.input,
          error && { borderColor: colors.danger },
          style,
        ]}
      />
      {error
        ? <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text>
        : hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

// ── Card ─────────────────────────────────────────────────────────

export function Card({ children, style, ...rest }: ViewProps & { children: React.ReactNode }) {
  return (
    <View {...rest} style={[styles.card, style]}>
      {children}
    </View>
  );
}

// ── Pill ─────────────────────────────────────────────────────────

export function Pill({ label, color = "ink", small }:
                       { label: string; color?: "ink" | "gold" | "navy" | "green" | "amber" | "red"; small?: boolean }) {
  const tone = PILL_TONES[color];
  return (
    <View style={[
      styles.pill, tone,
      small ? { paddingHorizontal: 6, paddingVertical: 1 } : null,
    ]}>
      <Text style={[styles.pillText, { color: tone.textColor as string },
                     small ? { fontSize: 10 } : null]}>
        {label}
      </Text>
    </View>
  );
}

const PILL_TONES = {
  ink:   { backgroundColor: colors.ink100, textColor: colors.ink700 },
  gold:  { backgroundColor: colors.goldGlow, textColor: colors.goldDark },
  navy:  { backgroundColor: colors.navy, textColor: colors.white },
  green: { backgroundColor: colors.successBg, textColor: "#15803D" },
  amber: { backgroundColor: colors.warningBg, textColor: "#92400E" },
  red:   { backgroundColor: colors.dangerBg, textColor: "#B91C1C" },
} as const;

// ── Loading screen ────────────────────────────────────────────────

export function Loading({ message }: { message?: string }) {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={colors.gold}/>
      {message && <Text style={styles.loadingText}>{message}</Text>}
    </View>
  );
}

// ── Eyebrow text ──────────────────────────────────────────────────

export function Eyebrow({ children, color = colors.gold }: { children: string; color?: string }) {
  return <Text style={[typography.eyebrow, { color }]}>{children}</Text>;
}


// ── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderRadius: radius.md, minHeight: 44,
  },
  btnText: { fontWeight: "700", letterSpacing: 0.2 },
  btnDisabled: { opacity: 0.5 },

  inputLabel: {
    fontSize: 11, letterSpacing: 1.4, fontWeight: "700",
    color: colors.ink600, marginBottom: 4, textTransform: "uppercase",
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1, borderColor: colors.ink200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    fontSize: 15, color: colors.navy,
  },
  hint: { fontSize: 11, color: colors.ink500, marginTop: 4 },

  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1, borderColor: colors.ink100,
    ...shadows.soft,
  },

  pill: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 6, alignSelf: "flex-start",
  },
  pillText: {
    fontSize: 11, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.4,
  },

  loadingContainer: {
    flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.huge,
  },
  loadingText: {
    marginTop: spacing.md, fontSize: 14, color: colors.ink500,
  },
});
