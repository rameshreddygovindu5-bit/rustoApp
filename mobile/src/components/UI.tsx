/**
 * Rusto UI Kit v2 — "Indian Dusk" design system
 *
 * Exports: Button, Input, Card, Pill, Loading, Skeleton,
 *          LodgeSkeleton, Eyebrow, EmptyState, ErrorBoundary,
 *          DatePickerField, AnimatedCard, ShimmerView, GoldDivider,
 *          TierBadge, RatingStars, PriceTag
 *
 * All animations use React Native's Animated API — no external deps.
 * Animations respect prefers-reduced-motion via AccessibilityInfo.
 */
import React, {
  Component, useRef, useEffect, useState, useCallback,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator, Animated, Easing, Modal, Platform,
  Pressable, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
  type PressableProps, type TextInputProps, type ViewProps,
} from "react-native";
import { Eye, EyeOff, Calendar, X, Star } from "lucide-react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { colors, radius, spacing, shadows, typography, timing } from "@/theme";

// ── Reduced-motion hook ───────────────────────────────────────────────────────
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduced);
    return () => sub?.remove?.();
  }, []);
  return reduced;
}

// ── Haptics (cached so require() runs once) ──────────────────────────────────
let _haptics: any = null;
function hapticLight() {
  try {
    if (!_haptics) _haptics = require("expo-haptics");
    _haptics.impactAsync(_haptics.ImpactFeedbackStyle.Light);
  } catch { /* not available */ }
}
function hapticMedium() {
  try {
    if (!_haptics) _haptics = require("expo-haptics");
    _haptics.impactAsync(_haptics.ImpactFeedbackStyle.Medium);
  } catch { /* not available */ }
}

// ── ShimmerView ──────────────────────────────────────────────────────────────
/**
 * Animated shimmer overlay — use as a child over any skeleton shape.
 * Mimics the CSS `@keyframes shimmer` from the web design system.
 */
export function ShimmerView({ style }: { style?: any }) {
  const reduced = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1, duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, anim]);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 200],
  });

  return (
    <View style={[{ overflow: "hidden" }, style]}>
      <Animated.View style={[
        StyleSheet.absoluteFill,
        {
          transform: [{ translateX }],
          backgroundColor: "rgba(255,255,255,0.22)",
          width: 80,
        },
      ]} />
    </View>
  );
}

// ── AnimatedCard ─────────────────────────────────────────────────────────────
/**
 * Fade-in + rise-up entrance animation, matching web's `animate-rise-up`.
 * Wrap any card/section in this for coordinated page entrances.
 */
export function AnimatedCard({
  children, delay = 0, style, ...rest
}: ViewProps & { delay?: number }) {
  const reduced = useReducedMotion();
  const opacity   = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const translateY= useRef(new Animated.Value(reduced ? 0 : 24)).current;

  useEffect(() => {
    if (reduced) return;
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1, duration: timing.slow, delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0, duration: timing.slow, delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [delay, reduced]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]} {...rest}>
      {children}
    </Animated.View>
  );
}

// ── PulseView ────────────────────────────────────────────────────────────────
/** Gentle breathing pulse — used on gold badges and CTA highlights. */
export function PulseView({ children, style }: ViewProps & { children?: React.ReactNode }) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.04, duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1, duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [reduced]);

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      {children}
    </Animated.View>
  );
}

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "gold" | "outline" | "ghost" | "danger" | "terracotta";

interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  title:      string;
  variant?:   ButtonVariant;
  loading?:   boolean;
  fullWidth?: boolean;
  icon?:      React.ReactNode;
  small?:     boolean;
}

const BUTTON_CFG: Record<ButtonVariant, {
  bg: string; text: string; border?: string; shadow?: object;
}> = {
  primary:    { bg: colors.navy,       text: colors.white,     shadow: shadows.soft },
  gold:       { bg: colors.gold,       text: colors.navyDark,  shadow: shadows.gold },
  outline:    { bg: "transparent",     text: colors.navy,      border: colors.ink200 },
  ghost:      { bg: "transparent",     text: colors.ink500 },
  danger:     { bg: colors.danger,     text: colors.white },
  terracotta: { bg: colors.terracotta, text: colors.white,     shadow: shadows.terracotta },
};

export function Button({
  title, variant = "primary", loading, fullWidth, icon,
  small, disabled, onPress, ...rest
}: ButtonProps) {
  const reduced = useReducedMotion();
  const cfg   = BUTTON_CFG[variant];
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    if (reduced) return;
    Animated.spring(scale, {
      toValue: 0.96, useNativeDriver: true,
      speed: 40, bounciness: 4,
    }).start();
  }, [reduced, scale]);

  const handlePressOut = useCallback(() => {
    if (reduced) return;
    Animated.spring(scale, {
      toValue: 1, useNativeDriver: true,
      speed: 40, bounciness: 8,
    }).start();
  }, [reduced, scale]);

  const handlePress = useCallback((e: any) => {
    hapticLight();
    onPress?.(e);
  }, [onPress]);

  const padV = small ? spacing.sm  : 14;
  const padH = small ? spacing.lg  : spacing.xl;

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      {...rest}
    >
      <Animated.View style={[
        styles.btn,
        { backgroundColor: cfg.bg, paddingVertical: padV, paddingHorizontal: padH },
        cfg.border && { borderWidth: 1.5, borderColor: cfg.border },
        cfg.shadow,
        fullWidth && { width: "100%" },
        (disabled || loading) && { opacity: 0.55 },
        { transform: [{ scale }] },
      ]}>
        {loading ? (
          <ActivityIndicator size="small" color={cfg.text} />
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, justifyContent: "center" }}>
            {icon && <View>{icon}</View>}
            <Text style={[
              styles.btnText,
              { color: cfg.text, fontSize: small ? 13 : 15 },
            ]}>
              {title}
            </Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

// ── Input ────────────────────────────────────────────────────────────────────

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?:  string;
  required?: boolean;
  style?: any;
}

export function Input({ label, error, hint, required, style, secureTextEntry, ...rest }: InputProps) {
  const [show, setShow] = useState(!secureTextEntry);
  const [focused, setFocused] = useState(false);
  const borderAnim = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();

  const animateFocus = (isFocused: boolean) => {
    if (reduced) { setFocused(isFocused); return; }
    setFocused(isFocused);
    Animated.timing(borderAnim, {
      toValue: isFocused ? 1 : 0, duration: timing.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  };

  const borderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.ink200, colors.gold],
  });

  return (
    <View style={[styles.inputWrap, style]}>
      {label && (
        <Text style={styles.inputLabel}>
          {label}{required && <Text style={{ color: colors.terracotta }}> *</Text>}
        </Text>
      )}
      <Animated.View style={[
        styles.inputBox,
        { borderColor },
        error && { borderColor: colors.danger },
      ]}>
        <TextInput
          {...rest}
          secureTextEntry={secureTextEntry && !show}
          style={styles.inputText}
          placeholderTextColor={colors.ink400}
          onFocus={(e) => { animateFocus(true); rest.onFocus?.(e); }}
          onBlur={(e)  => { animateFocus(false); rest.onBlur?.(e); }}
        />
        {secureTextEntry && (
          <TouchableOpacity onPress={() => setShow(s => !s)} style={{ paddingLeft: spacing.sm }}>
            {show
              ? <Eye    size={18} color={colors.ink400}/>
              : <EyeOff size={18} color={colors.ink400}/>}
          </TouchableOpacity>
        )}
      </Animated.View>
      {error && <Text style={styles.inputError}>{error}</Text>}
      {hint  && !error && <Text style={styles.inputHint}>{hint}</Text>}
    </View>
  );
}

// ── DatePickerField ──────────────────────────────────────────────────────────

interface DatePickerFieldProps {
  label:        string;
  value:        string;          // "YYYY-MM-DD"
  onChange:     (v: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
}

export function DatePickerField({ label, value, onChange, minimumDate, maximumDate }: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(value) : new Date();

  const onChangePicker = (_: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setOpen(false);
    if (selected) onChange(selected.toISOString().slice(0, 10));
  };

  const display = value
    ? new Date(value + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : "Select";

  if (Platform.OS === "android") {
    return (
      <>
        <Pressable
          onPress={() => setOpen(true)}
          style={styles.dateField}
          accessibilityLabel={label + ": " + display}>
          <Calendar size={14} color={colors.gold}/>
          <View style={{ marginLeft: 6 }}>
            <Text style={styles.dateFieldLabel}>{label}</Text>
            <Text style={styles.dateFieldValue}>{display}</Text>
          </View>
        </Pressable>
        {open && (
          <DateTimePicker
            value={date} mode="date" display="default"
            minimumDate={minimumDate} maximumDate={maximumDate}
            onChange={onChangePicker}
          />
        )}
      </>
    );
  }

  // iOS — bottom-sheet modal
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.dateField}
        accessibilityLabel={label + ": " + display}>
        <Calendar size={14} color={colors.gold}/>
        <View style={{ marginLeft: 6 }}>
          <Text style={styles.dateFieldLabel}>{label}</Text>
          <Text style={styles.dateFieldValue}>{display}</Text>
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="slide"
             onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dateModalBackdrop} onPress={() => setOpen(false)}/>
        <View style={styles.dateModalSheet}>
          <View style={styles.dateModalHandle}/>
          <View style={styles.dateModalHeader}>
            <Text style={styles.dateModalTitle}>{label}</Text>
            <TouchableOpacity onPress={() => setOpen(false)}>
              <X size={20} color={colors.ink500}/>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={date} mode="date" display="spinner"
            minimumDate={minimumDate} maximumDate={maximumDate}
            onChange={onChangePicker}
            textColor={colors.navy}
          />
          <View style={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
            <Button title="Done" variant="gold" fullWidth onPress={() => setOpen(false)}/>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({ children, style, ...rest }: ViewProps & { children: React.ReactNode }) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

// ── GoldDivider ──────────────────────────────────────────────────────────────

export function GoldDivider({ style }: { style?: any }) {
  return (
    <View style={[styles.goldDivider, style]}>
      <View style={styles.goldDividerLine}/>
      <View style={styles.goldDividerDot}/>
      <View style={styles.goldDividerLine}/>
    </View>
  );
}

// ── Pill ─────────────────────────────────────────────────────────────────────

type PillColor = "ink" | "gold" | "navy" | "green" | "amber" | "red" | "terracotta";
const PILL_COLORS: Record<PillColor, { bg: string; text: string; border?: string }> = {
  ink:        { bg: colors.ink100,   text: colors.ink700 },
  gold:       { bg: colors.goldGlow, text: colors.goldDark,     border: colors.goldLight },
  navy:       { bg: colors.navy,     text: colors.white },
  green:      { bg: colors.sageBg,   text: colors.sage },
  amber:      { bg: colors.goldGlow, text: colors.goldDark },
  red:        { bg: colors.dangerBg, text: colors.danger },
  terracotta: { bg: "#FDF0EC",       text: colors.terracotta },
};

export function Pill({ label, color = "ink", small }: {
  label: string; color?: PillColor; small?: boolean;
}) {
  const cfg = PILL_COLORS[color];
  return (
    <View style={[
      styles.pill,
      { backgroundColor: cfg.bg },
      cfg.border && { borderWidth: 1, borderColor: cfg.border },
      small && { paddingHorizontal: 6, paddingVertical: 2 },
    ]}>
      <Text style={[
        styles.pillText,
        { color: cfg.text, fontSize: small ? 9 : 11 },
      ]}>
        {label}
      </Text>
    </View>
  );
}

// ── TierBadge ────────────────────────────────────────────────────────────────
/** Membership tier display with animated glow on Gold/Elite. */
export function TierBadge({ tier }: { tier: string }) {
  const configs: Record<string, { bg: string; text: string; emoji: string; glow?: boolean }> = {
    explorer: { bg: colors.ink100,   text: colors.ink700,  emoji: "🧭" },
    silver:   { bg: colors.ink200,   text: colors.ink800,  emoji: "🥈" },
    gold:     { bg: colors.goldGlow, text: colors.goldDark, emoji: "🥇", glow: true },
    elite:    { bg: colors.navy,     text: colors.goldLight, emoji: "👑", glow: true },
  };
  const cfg = configs[tier.toLowerCase()] ?? configs.explorer;

  const badge = (
    <View style={[styles.tierBadge, { backgroundColor: cfg.bg }]}>
      <Text style={styles.tierBadgeEmoji}>{cfg.emoji}</Text>
      <Text style={[styles.tierBadgeLabel, { color: cfg.text }]}>
        {tier.charAt(0).toUpperCase() + tier.slice(1)}
      </Text>
    </View>
  );

  return cfg.glow ? <PulseView>{badge}</PulseView> : badge;
}

// ── RatingStars ──────────────────────────────────────────────────────────────
export function RatingStars({ rating, size = 14, interactive = false, onChange }: {
  rating: number; size?: number; interactive?: boolean; onChange?: (n: number) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Pressable key={i}
          onPress={interactive ? () => { hapticLight(); onChange?.(i); } : undefined}
          disabled={!interactive}>
          <Star
            size={size}
            color={i <= rating ? colors.gold : colors.ink200}
            fill={i <= rating ? colors.gold : "none"}
          />
        </Pressable>
      ))}
    </View>
  );
}

// ── PriceTag ─────────────────────────────────────────────────────────────────
export function PriceTag({ price, suffix = "/night", style }: {
  price: number; suffix?: string; style?: any;
}) {
  const formatted = price.toLocaleString("en-IN");
  return (
    <View style={[{ flexDirection: "row", alignItems: "baseline", gap: 1 }, style]}>
      <Text style={styles.priceSymbol}>₹</Text>
      <Text style={styles.priceValue}>{formatted}</Text>
      <Text style={styles.priceSuffix}>{suffix}</Text>
    </View>
  );
}

// ── Loading ──────────────────────────────────────────────────────────────────

export function Loading({ message }: { message?: string }) {
  return (
    <View style={styles.loadingWrap}>
      <View style={styles.loadingMark}>
        <ActivityIndicator size="large" color={colors.gold}/>
      </View>
      {message && <Text style={styles.loadingText}>{message}</Text>}
    </View>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

export function Skeleton({ width, height, radius: br, style }: {
  width?: number | string; height: number; radius?: number; style?: any;
}) {
  return (
    <View style={[
      styles.skeleton,
      { width: width ?? "100%", height, borderRadius: br ?? radius.md },
      style,
    ]}>
      <ShimmerView style={StyleSheet.absoluteFill}/>
    </View>
  );
}

// ── LodgeSkeleton ────────────────────────────────────────────────────────────

export function LodgeSkeleton() {
  return (
    <View style={[styles.card, { marginBottom: spacing.md, overflow: "hidden" }]}>
      <Skeleton height={170} radius={0}/>
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <Skeleton height={16} width="70%"/>
        <Skeleton height={12} width="45%"/>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Skeleton height={22} width={60} radius={radius.sm}/>
          <Skeleton height={22} width={50} radius={radius.sm}/>
          <Skeleton height={22} width={70} radius={radius.sm}/>
        </View>
      </View>
    </View>
  );
}

// ── Eyebrow ──────────────────────────────────────────────────────────────────

export function Eyebrow({ children, color = colors.gold }: {
  children: string; color?: string;
}) {
  return (
    <View style={styles.eyebrowRow}>
      <View style={[styles.eyebrowDot, { backgroundColor: color }]}/>
      <Text style={[styles.eyebrowText, { color }]}>{children}</Text>
    </View>
  );
}

// ── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description, action, actionLabel }: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <AnimatedCard style={styles.emptyWrap}>
      {icon && <View style={styles.emptyIcon}>{icon}</View>}
      <Text style={styles.emptyTitle}>{title}</Text>
      {description && <Text style={styles.emptyDesc}>{description}</Text>}
      {action && actionLabel && (
        <View style={{ marginTop: spacing.lg }}>
          <Button title={actionLabel} variant="gold" onPress={action}/>
        </View>
      )}
    </AnimatedCard>
  );
}

// ── ErrorBoundary ─────────────────────────────────────────────────────────────

interface ErrorBoundaryState { hasError: boolean; error?: Error; }
export class ErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };
  static getDerivedStateFromError(e: Error) { return { hasError: true, error: e }; }
  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <View style={styles.errWrap}>
        <Text style={styles.errTitle}>Something went wrong</Text>
        <Text style={styles.errMsg}>{this.state.error?.message ?? "Unknown error"}</Text>
      </View>
    );
  }
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Button
  btn: {
    borderRadius: radius.lg,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row",
  },
  btnText: { fontWeight: "700", letterSpacing: 0.1 },

  // Input
  inputWrap:  { marginBottom: spacing.md },
  inputLabel: {
    fontSize: 12, fontWeight: "600", color: colors.ink600,
    marginBottom: 6, letterSpacing: 0.2,
  },
  inputBox: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.white,
    borderWidth: 1.5, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  inputText: {
    flex: 1, fontSize: 15, color: colors.navy,
    fontWeight: "400", paddingVertical: 0,
  },
  inputError: { fontSize: 11, color: colors.danger, marginTop: 4 },
  inputHint:  { fontSize: 11, color: colors.ink500, marginTop: 4 },

  // DatePicker
  dateField: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.white,
    borderWidth: 1.5, borderColor: colors.ink200,
    borderRadius: radius.md, paddingHorizontal: spacing.md,
    paddingVertical: 10, flex: 1,
  },
  dateFieldLabel: { fontSize: 9, color: colors.ink400, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  dateFieldValue: { fontSize: 13, color: colors.navy, fontWeight: "700", marginTop: 1 },
  dateModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7,19,28,0.6)",
  },
  dateModalSheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    paddingTop: spacing.sm,
  },
  dateModalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.ink200, alignSelf: "center", marginBottom: spacing.md,
  },
  dateModalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg, marginBottom: spacing.md,
  },
  dateModalTitle: { fontSize: 17, fontWeight: "700", color: colors.navy },

  // Card
  card: {
    backgroundColor: colors.white, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.ink100,
    ...shadows.card,
  },

  // GoldDivider
  goldDivider: { flexDirection: "row", alignItems: "center", marginVertical: spacing.lg },
  goldDividerLine: { flex: 1, height: 1, backgroundColor: colors.goldLight, opacity: 0.4 },
  goldDividerDot:  {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.gold, marginHorizontal: spacing.sm,
  },

  // Pill
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  pillText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3, textTransform: "uppercase" },

  // TierBadge
  tierBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 5,
    borderRadius: radius.full, alignSelf: "flex-start",
  },
  tierBadgeEmoji: { fontSize: 14 },
  tierBadgeLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.2 },

  // PriceTag
  priceSymbol: { fontSize: 12, fontWeight: "700", color: colors.navy, lineHeight: 22 },
  priceValue:  { fontSize: 20, fontWeight: "800", color: colors.navy, letterSpacing: -0.5 },
  priceSuffix: { fontSize: 11, color: colors.ink500, lineHeight: 22, marginLeft: 1 },

  // Skeleton
  skeleton: { backgroundColor: colors.ink100, overflow: "hidden" },

  // Loading
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.md, padding: spacing.huge },
  loadingMark: {
    width: 60, height: 60, borderRadius: radius.xl,
    backgroundColor: colors.goldGlow,
    justifyContent: "center", alignItems: "center", ...shadows.gold,
  },
  loadingText: { fontSize: 13, color: colors.ink500, marginTop: spacing.sm },

  // Eyebrow
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 4 },
  eyebrowDot: { width: 5, height: 5, borderRadius: 999 },
  eyebrowText: {
    fontSize: 10, fontWeight: "700",
    letterSpacing: 2.0, textTransform: "uppercase",
  },

  // EmptyState
  emptyWrap:  { alignItems: "center", padding: spacing.huge },
  emptyIcon:  {
    width: 64, height: 64, borderRadius: radius.xl,
    backgroundColor: colors.goldGlow, justifyContent: "center",
    alignItems: "center", marginBottom: spacing.lg, ...shadows.gold,
  },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.navy, textAlign: "center", marginBottom: 6 },
  emptyDesc:  { fontSize: 13, color: colors.ink500, textAlign: "center", lineHeight: 20 },

  // ErrorBoundary
  errWrap:  { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xxl },
  errTitle: { fontSize: 16, fontWeight: "700", color: colors.danger, marginBottom: 8 },
  errMsg:   { fontSize: 12, color: colors.ink500, textAlign: "center" },
});
