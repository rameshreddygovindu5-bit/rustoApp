import React, { useState, useCallback } from "react";
import {
  ScrollView, View, Text, StyleSheet, Pressable, Alert,
  RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import {
  User, BookOpen, LogOut, Phone, Mail, MapPin,
  Sparkles, ArrowRight, Heart, Award, Edit3, MessageSquare,
} from "lucide-react-native";
import { useAuth } from "@/context/AuthContext";
import { rustoBookings, Booking } from "@/api/rusto";
import { colors, radius, shadows, spacing } from "@/theme";
import { Button, Card, Loading, Pill, EmptyState } from "@/components/UI";
import { inr, tinyDate, errorMessage } from "@/lib/format";

type Tab = "profile" | "bookings";

export default function Account() {
  const { customer, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("profile");
  const router = useRouter();

  if (loading) return <Loading message="Loading..."/>;

  if (!customer) return (
    <View style={styles.guestContainer}>
      {/* App identity — make it clear this is Customer Booking */}
      <View style={styles.appBadge}>
        <Text style={styles.appBadgeIcon}>🏨</Text>
        <Text style={styles.appBadgeName}>Rusto · Guest App</Text>
      </View>

      <View style={styles.guestIcon}>
        <Sparkles size={28} color={colors.gold}/>
      </View>
      <Text style={styles.guestTitle}>Sign in to book</Text>
      <Text style={styles.guestDesc}>
        Search verified lodges across India, make reservations, and track your stays.
      </Text>
      <View style={{ marginTop: 24, alignSelf: "stretch", gap: 8 }}>
        <Button title="Sign in"        variant="gold"    fullWidth onPress={() => router.push("/signin")}/>
        <Button title="Create account" variant="outline" fullWidth onPress={() => router.push("/signup")}/>
      </View>

      {/* Clear separator between guest app and lodge management */}
      <View style={styles.portalDivider}>
        <View style={styles.portalDividerLine}/>
        <Text style={styles.portalDividerText}>Are you a lodge owner?</Text>
        <View style={styles.portalDividerLine}/>
      </View>
      <Text style={styles.portalHint}>
        Lodge management (PMS) is accessible at{" "}
        <Text style={styles.portalLink}>rusto.in/login</Text>
        {" "}on a web browser.
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink50 }}>
      {/* Tab switcher */}
      <View style={styles.tabRow}>
        <TabBtn label="Profile"  Icon={User}     active={tab === "profile"}  onPress={() => setTab("profile")}/>
        <TabBtn label="Bookings" Icon={BookOpen}  active={tab === "bookings"} onPress={() => setTab("bookings")}/>
      </View>

      {tab === "profile" ? <ProfilePanel/> : <BookingsPanel/>}
    </View>
  );
}

function TabBtn({ label, Icon, active, onPress }: {
  label: string; Icon: any; active: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabBtn, active && styles.tabBtnActive]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}>
      <Icon size={14} color={active ? colors.navy : colors.ink500}/>
      <Text style={[styles.tabBtnText, active && { color: colors.navy }]}>{label}</Text>
    </Pressable>
  );
}

function ProfilePanel() {
  const { customer, logout } = useAuth();
  const router = useRouter();
  if (!customer) return null;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <Card>
        <View style={styles.profHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{customer.full_name?.[0]?.toUpperCase() ?? "?"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profName}>{customer.full_name}</Text>
            <Text style={styles.profMeta}>
              {customer.last_login_at
                ? "Member since " + new Date(customer.last_login_at).getFullYear()
                : "Rusto member"}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/edit-profile" as any)}
            hitSlop={8}
            accessibilityLabel="Edit profile">
            <Edit3 size={16} color={colors.ink400}/>
          </Pressable>
        </View>
        <View style={styles.profFields}>
          <Field icon={<Phone size={13} color={colors.ink400}/>} label="Phone" value={customer.phone}/>
          <Field icon={<Mail  size={13} color={colors.ink400}/>} label="Email" value={customer.email}/>
          <Field icon={<MapPin size={13} color={colors.ink400}/>} label="City" value={customer.city}/>
        </View>
      </Card>

      {/* Quick links */}
      <Card style={{ padding: 0, overflow: "hidden", marginTop: spacing.md }}>
        <QuickLink
          icon={<Heart size={16} color={colors.goldDark}/>}
          label="My wishlist"
          onPress={() => router.push("/wishlist" as any)}
        />
        <View style={styles.linkDivider}/>
        <QuickLink
          icon={<Award size={16} color={colors.goldDark}/>}
          label="Rusto membership & points"
          onPress={() => router.push("/membership" as any)}
        />
        <View style={styles.linkDivider}/>
        <QuickLink
          icon={<MessageSquare size={16} color={colors.goldDark}/>}
          label="My reviews"
          onPress={() => router.push("/my-reviews" as any)}
        />
      </Card>

      {/* Sign out */}
      <View style={{ marginTop: spacing.md }}>
        <Button
          title="Sign out"
          variant="outline"
          fullWidth
          icon={<LogOut size={14} color={colors.navy}/>}
          onPress={async () => {
            await logout();
            router.replace("/(tabs)" as any);
          }}
        />
      </View>
    </ScrollView>
  );
}

function QuickLink({ icon, label, onPress }: {
  icon: React.ReactNode; label: string; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quickLink, pressed && { backgroundColor: colors.ink50 }]}>
      <View style={styles.quickLinkIcon}>{icon}</View>
      <Text style={styles.quickLinkLabel}>{label}</Text>
      <ArrowRight size={14} color={colors.ink400}/>
    </Pressable>
  );
}

function Field({ icon, label, value }: {
  icon: React.ReactNode; label: string; value: string | null | undefined;
}) {
  return (
    <View style={styles.fieldRow}>
      <View style={{ marginTop: 3 }}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue}>
          {value ?? <Text style={{ color: colors.ink400, fontStyle: "italic" }}>Not set</Text>}
        </Text>
      </View>
    </View>
  );
}

function BookingsPanel() {
  const [bookings,   setBookings]  = useState<Booking[]>([]);
  const [loading,    setLoading]   = useState(true);
  const [refreshing, setRefreshing]= useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await rustoBookings.list();
      // API returns plain list or may return paginated — handle both
      const data = r.data;
      setBookings(Array.isArray(data) ? data : (data as any).bookings ?? []);
    } catch (e) {
      Alert.alert("Could not load bookings", errorMessage(e));
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const cancel = (b: Booking) => {
    Alert.alert(
      "Cancel booking?", b.booking_ref,
      [
        { text: "Keep",  style: "cancel" },
        { text: "Cancel booking", style: "destructive", onPress: async () => {
          try {
            await rustoBookings.cancel(b.booking_id, "Cancelled by customer");
            load();
          } catch (e) { Alert.alert("Failed", errorMessage(e)); }
        }},
      ]
    );
  };

  if (loading) return <Loading message="Loading bookings..."/>;

  if (bookings.length === 0) return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}/>}>
      <EmptyState
        icon={<BookOpen size={36} color={colors.ink300}/>}
        title="No bookings yet"
        description="Start exploring lodges across India."
        action={() => router.push("/(tabs)/search" as any)}
        actionLabel="Browse lodges"
      />
    </ScrollView>
  );

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.huge }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.gold}
        />
      }>
      {bookings.map(b => (
        <BookingRow key={b.booking_id} b={b} onCancel={cancel}/>
      ))}
    </ScrollView>
  );
}

function BookingRow({ b, onCancel }: { b: Booking; onCancel: (b: Booking) => void }) {
  const router = useRouter();
  const status   = STATUS_PILL[b.status] ?? { color: "ink" as const, label: b.status };
  const canPay   = b.status === "payment_pending";
  const canCancel= ["confirmed", "payment_pending", "initiated"].includes(b.status);

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between",
                     alignItems: "flex-start", marginBottom: 4 }}>
        <Text style={styles.bookingRef}>{b.booking_ref}</Text>
        <Pill label={status.label} color={status.color}/>
      </View>
      <Text style={styles.bookingLodge}>{b.lodge?.display_name || b.lodge?.name || "Lodge"}</Text>
      <Text style={styles.bookingMeta}>
        {b.lodge?.city}{b.lodge?.state ? ", " + b.lodge.state : ""}
      </Text>
      <View style={styles.bookingGrid}>
        <Stat label="Check-in"  value={tinyDate(b.checkin_date)}/>
        <Stat label="Check-out" value={tinyDate(b.checkout_date)}/>
        <Stat label="Room"      value={b.room_type_label + " x " + b.rooms_count}/>
        <Stat label="Total"     value={inr(b.total_amount)} highlight/>
      </View>
      {(canPay || canCancel) && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.md,
                       paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.ink100 }}>
          {canPay && (
            <Button
              title="Complete payment"
              variant="gold"
              small
              icon={<ArrowRight size={11} color={colors.navyDark}/>}
              onPress={() => router.push({
                pathname: "/checkout/[bookingId]",
                params:   { bookingId: String(b.booking_id) },
              } as any)}
            />
          )}
          {canCancel && (
            <Button title="Cancel" variant="outline" small onPress={() => onCancel(b)}/>
          )}
        </View>
      )}
    </Card>
  );
}

function Stat({ label, value, highlight }: {
  label: string; value: string; highlight?: boolean;
}) {
  return (
    <View style={{ minWidth: "45%", marginBottom: 4 }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, highlight && { color: colors.goldDark, fontWeight: "700" }]}>
        {value}
      </Text>
    </View>
  );
}

const STATUS_PILL: Record<string, { color: "ink"|"gold"|"navy"|"green"|"amber"|"red"; label: string }> = {
  initiated:       { color: "ink",   label: "Started" },
  payment_pending: { color: "amber", label: "Pay due" },
  confirmed:       { color: "green", label: "Confirmed" },
  checked_in:      { color: "navy",  label: "Checked in" },
  checked_out:     { color: "ink",   label: "Completed" },
  cancelled:       { color: "red",   label: "Cancelled" },
  payment_failed:  { color: "red",   label: "Pay failed" },
};

const styles = StyleSheet.create({
  guestContainer: {
    flex: 1, justifyContent: "center", alignItems: "center",
    padding: spacing.huge, backgroundColor: colors.ink50,
  },
  guestIcon: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: colors.navyDark, justifyContent: "center", alignItems: "center",
    marginBottom: spacing.lg, ...shadows.gold,
  },
  // App identity badge
  appBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.goldGlow, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 5,
    marginBottom: 20, alignSelf: "center",
  },
  appBadgeIcon:  { fontSize: 14 },
  appBadgeName:  { fontSize: 11, fontWeight: "800", color: colors.goldDark, letterSpacing: 0.5, textTransform: "uppercase" },

  // Portal divider
  portalDivider: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 12, alignSelf: "stretch" },
  portalDividerLine: { flex: 1, height: 1, backgroundColor: colors.ink200 },
  portalDividerText: { fontSize: 11, color: colors.ink500, fontWeight: "600", flexShrink: 0 },
  portalHint: { fontSize: 12, color: colors.ink500, textAlign: "center", lineHeight: 18 },
  portalLink: { color: colors.gold, fontWeight: "700" },

  guestTitle: { fontSize: 24, fontWeight: "700", color: colors.navy, letterSpacing: -0.5 },
  guestDesc:  {
    fontSize: 14, color: colors.ink500, textAlign: "center",
    lineHeight: 20, marginTop: 6, maxWidth: 320,
  },
  tabRow: {
    flexDirection: "row", backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.ink100,
    paddingHorizontal: spacing.lg,
  },
  tabBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  tabBtnActive: { borderBottomColor: colors.gold },
  tabBtnText:   { color: colors.ink500, fontWeight: "600", fontSize: 13 },

  profHeader: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingBottom: spacing.md, marginBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.ink100,
  },
  avatar:     {
    width: 56, height: 56, borderRadius: 18,
    backgroundColor: colors.navy, justifyContent: "center", alignItems: "center",
    ...shadows.soft,
  },
  avatarText: { color: colors.white, fontWeight: "700", fontSize: 22 },
  profName:   { fontSize: 18, fontWeight: "700", color: colors.navy },
  profMeta:   { fontSize: 12, color: colors.ink500, marginTop: 2 },
  profFields: { gap: 12, marginBottom: spacing.md },
  fieldRow:   { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  fieldLabel: {
    fontSize: 10, color: colors.ink500, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1, marginBottom: 1,
  },
  fieldValue: { fontSize: 14, color: colors.navy },

  quickLink: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md,
  },
  quickLinkIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: colors.goldGlow, justifyContent: "center", alignItems: "center",
  },
  quickLinkLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.navy },
  linkDivider:    { height: 1, backgroundColor: colors.ink100, marginHorizontal: spacing.md },

  bookingRef:   { fontSize: 11, color: colors.ink400, fontFamily: "monospace" },
  bookingLodge: { fontSize: 17, fontWeight: "700", color: colors.navy, marginTop: 2 },
  bookingMeta:  { fontSize: 12, color: colors.ink500, marginTop: 2 },
  bookingGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.md },
  statLabel:    {
    fontSize: 10, color: colors.ink500, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  statValue:    { fontSize: 13, color: colors.navy, fontWeight: "600", marginTop: 2 },
  empty:        {
    backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.huge,
    alignItems: "center", borderWidth: 1, borderColor: colors.ink100,
  },
  emptyTitle:   { fontSize: 18, fontWeight: "700", color: colors.navy, marginTop: 12 },
  emptyDesc:    { fontSize: 13, color: colors.ink500, marginTop: 4, textAlign: "center" },
});
