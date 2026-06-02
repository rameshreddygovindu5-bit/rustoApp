import React, { useState, useEffect } from "react";
import { ScrollView, View, Text, StyleSheet, Alert, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, MapPin, CreditCard, Shield, AlertCircle } from "lucide-react-native";
import { colors, radius, spacing, shadows } from "@/theme";
import { Button, Card, Eyebrow, Loading, Pill } from "@/components/UI";
import { useAuth } from "@/context/AuthContext";
import { rustoBookings, Booking, RazorpayOrderPayload } from "@/api/rusto";
import { inr, errorMessage } from "@/lib/format";

/**
 * Checkout screen — finalize an existing booking via Razorpay.
 *
 * Two paths:
 *   - Mock mode (backend reports razorpay.is_mock = true): on tap, call
 *     verify-payment with `mock_signature`. No native module needed —
 *     works in Expo Go.
 *   - Live mode: requires the `react-native-razorpay` package, which is
 *     a native module (NOT compatible with Expo Go — you must run
 *     `expo prebuild` and ship a dev client / standalone build).
 *
 *     The integration is wired but DEFENSIVELY — we wrap the import in a
 *     try/catch so the app still loads in Expo Go even though the
 *     module isn't installed there. The README explains the prebuild step.
 *
 * The booking is re-fetched here (rather than passed via navigation state)
 * because Expo Router params don't carry complex objects gracefully.
 */
export default function Checkout() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const { customer } = useAuth();

  const [booking, setBooking]   = useState<Booking | null>(null);
  const [loading, setLoading]   = useState(true);
  const [paying,  setPaying]    = useState(false);
  const [done,    setDone]      = useState(false);

  // The Razorpay payload is only returned in the CREATE response. On a
  // refresh / deep-link arrival, we don't have it — show a degraded view
  // that still lets the user see status + cancel.
  // For the happy path (just-created bookings), we re-create the order
  // by calling POST /bookings again would be wasteful; instead we tell the
  // user to start over. In practice the create flow navigates here right
  // after creation, so this scenario is rare.

  useEffect(() => {
    let cancelled = false;
    rustoBookings.get(+(bookingId as string))
      .then(r => { if (!cancelled) setBooking(r.data); })
      .catch(e => Alert.alert("Couldn't load booking", errorMessage(e)))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookingId]);

  const handlePay = async () => {
    if (!booking) return;
    setPaying(true);
    try {
      // To complete a real payment we need a fresh Razorpay order. The
      // create endpoint generates one with each call, so we re-call it
      // here to mint a new order for the same booking. (The booking row
      // and ref are reused; a fresh Payment row is created on the backend.)
      //
      // For a production app we'd cleaner to expose a "create new payment
      // attempt" endpoint that mints a fresh order against the existing
      // booking_id without creating a duplicate booking. For now we
      // re-issue create with the same dates/room_type, which the backend
      // will refuse if inventory has been taken. That's acceptable
      // friction for v0.1 of the mobile app.
      const fresh = await rustoBookings.create({
        lodge_code: booking.lodge!.code,
        room_type: booking.room_type,
        rooms_count: booking.rooms_count,
        checkin_date: booking.checkin_date,
        checkout_date: booking.checkout_date,
        adults: booking.adults,
        children: booking.children,
        contact_name: booking.contact_name,
        contact_phone: booking.contact_phone,
        contact_email: booking.contact_email || undefined,
        special_requests: booking.special_requests || undefined,
      });
      const newBooking = fresh.data.booking;
      const rzp = fresh.data.razorpay;

      if (rzp.is_mock) {
        const r = await rustoBookings.verifyPayment(newBooking.booking_id, {
          razorpay_order_id: rzp.order_id,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: "mock_signature",
        });
        setBooking((r.data as any).booking);
        setDone(true);
      } else {
        await openRazorpayCheckout(newBooking, rzp);
      }
    } catch (e) {
      Alert.alert("Payment failed", errorMessage(e));
    } finally { setPaying(false); }
  };

  async function openRazorpayCheckout(b: Booking, rzp: RazorpayOrderPayload) {
    // Lazy import — works in dev client / standalone build only.
    let RazorpayCheckout: any;
    try { RazorpayCheckout = require("react-native-razorpay").default; }
    catch {
      Alert.alert(
        "Live payments not available in Expo Go",
        "Run `expo prebuild` and start a dev client to enable Razorpay. See mobile/README.md.",
      );
      return;
    }
    const options = {
      key: rzp.key_id,
      order_id: rzp.order_id,
      amount: rzp.amount, currency: rzp.currency,
      name: rzp.name, description: rzp.description,
      prefill: rzp.prefill,
      theme: { color: colors.gold },
    };
    try {
      const data = await RazorpayCheckout.open(options);
      const r = await rustoBookings.verifyPayment(b.booking_id, {
        razorpay_order_id: data.razorpay_order_id,
        razorpay_payment_id: data.razorpay_payment_id,
        razorpay_signature: data.razorpay_signature,
      });
      setBooking((r.data as any).booking);
      setDone(true);
    } catch (e: any) {
      // Razorpay returns { code, description } on cancel/failure.
      if (e?.code !== 0) Alert.alert("Payment cancelled", e?.description || "Payment was not completed");
    }
  }

  if (loading) return <Loading message="Loading…"/>;
  if (!booking) return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl }}>
      <AlertCircle size={36} color={colors.danger}/>
      <Text style={styles.notFound}>Booking not found</Text>
    </View>
  );

  // Confirmation screen
  if (done || booking.status === "confirmed") return (
    <ScrollView contentContainerStyle={{ padding: spacing.xl, alignItems: "center", paddingTop: spacing.huge }}>
      <View style={styles.successIcon}>
        <CheckCircle2 size={42} color={colors.white}/>
      </View>
      <Text style={styles.successTitle}>Booking confirmed!</Text>
      <Text style={styles.successSub}>
        Your stay at <Text style={{ fontWeight: "700" }}>{booking.lodge?.name}</Text> is locked in.
      </Text>
      <Card style={{ marginTop: spacing.xl, alignSelf: "stretch" }}>
        <Row label="Booking ref" value={booking.booking_ref} mono/>
        <Row label="Check-in"    value={booking.checkin_date}/>
        <Row label="Check-out"   value={booking.checkout_date}/>
        <Row label="Room"        value={`${booking.room_type_label} × ${booking.rooms_count}`}/>
        <Row label="Total paid"  value={inr(booking.total_amount)} highlight/>
      </Card>
      <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.xl, alignSelf: "stretch" }}>
        <View style={{ flex: 1 }}>
          <Button title="My bookings" variant="primary" fullWidth
                   onPress={() => router.replace("/(tabs)/account")}/>
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Keep browsing" variant="outline" fullWidth
                   onPress={() => router.replace("/(tabs)" as any)}/>
        </View>
      </View>
    </ScrollView>
  );

  // Pay screen
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink50 }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
        <Eyebrow>Checkout</Eyebrow>
        <Text style={styles.title}>Review &amp; pay</Text>

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={styles.lodgeName}>{booking.lodge?.name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            <MapPin size={11} color={colors.ink500}/>
            <Text style={styles.lodgeLoc}>{booking.lodge?.city}{booking.lodge?.state ? ", " + booking.lodge.state : ""}</Text>
          </View>
          <View style={{ marginTop: spacing.md }}>
            <Row label="Check-in"   value={booking.checkin_date}/>
            <Row label="Check-out"  value={booking.checkout_date}/>
            <Row label="Nights"     value={String(booking.nights)}/>
            <Row label="Guests"     value={`${booking.adults} adult${booking.adults > 1 ? "s" : ""}`}/>
            <Row label="Room type"  value={booking.room_type_label}/>
            <Row label="Rooms"      value={String(booking.rooms_count)}/>
          </View>
          {booking.special_requests ? (
            <View style={{ marginTop: 10, padding: 10, backgroundColor: colors.goldGlow, borderRadius: radius.md }}>
              <Text style={{ fontSize: 10, fontWeight: "700", color: colors.goldDark,
                              textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                Special requests
              </Text>
              <Text style={{ fontSize: 13, color: colors.ink700 }}>{booking.special_requests}</Text>
            </View>
          ) : null}
        </Card>

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={styles.subhead}>Contact</Text>
          <Row label="Name"  value={booking.contact_name}/>
          <Row label="Phone" value={booking.contact_phone}/>
          {booking.contact_email ? <Row label="Email" value={booking.contact_email}/> : null}
        </Card>

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={styles.subhead}>Price</Text>
          <View style={{ marginTop: spacing.sm }}>
            <RowLine label={`${inr(booking.tariff_per_night)} × ${booking.rooms_count} × ${booking.nights}n`}
                       value={inr(booking.subtotal)}/>
            {booking.gst_amount > 0 && (
              <RowLine label="GST" value={inr(booking.gst_amount)} muted/>
            )}
            <View style={styles.totalDivider}/>
            <RowLine label="Total" value={inr(booking.total_amount)} bold/>
          </View>
        </Card>
      </ScrollView>

      <View style={styles.cta}>
        <Button
          title={paying ? "Opening payment…" : `Pay ${inr(booking.total_amount)}`}
          variant="gold"
          fullWidth
          loading={paying}
          icon={<CreditCard size={14} color={colors.navyDark}/>}
          onPress={handlePay}/>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center",
                       gap: 4, marginTop: 6 }}>
          <Shield size={10} color={colors.success}/>
          <Text style={{ fontSize: 10, color: colors.ink500 }}>Secure payment via Razorpay</Text>
        </View>
      </View>
    </View>
  );
}


function Row({ label, value, highlight, mono }:
              { label: string; value: string | number; highlight?: boolean; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue,
                     highlight && { color: colors.goldDark, fontWeight: "700" },
                     mono && { fontFamily: "Courier" }]}>{value}</Text>
    </View>
  );
}

function RowLine({ label, value, bold, muted }:
                  { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <View style={[styles.rowLine, muted && { opacity: 0.7 }]}>
      <Text style={[styles.rowLineLabel, bold && { fontWeight: "700", color: colors.navy }]}>{label}</Text>
      <Text style={[styles.rowLineValue,
                     bold && { color: colors.goldDark, fontWeight: "700", fontSize: 16 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notFound: { fontSize: 16, fontWeight: "700", color: colors.navy, marginTop: spacing.md },

  title: { fontSize: 24, fontWeight: "700", color: colors.navy, marginTop: 4, letterSpacing: -0.5 },
  subhead: { fontSize: 14, fontWeight: "700", color: colors.navy },
  lodgeName: { fontSize: 17, fontWeight: "700", color: colors.navy },
  lodgeLoc:  { fontSize: 12, color: colors.ink500 },

  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  rowLabel: { fontSize: 13, color: colors.ink500 },
  rowValue: { fontSize: 13, color: colors.navy, fontWeight: "600" },

  rowLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  rowLineLabel: { fontSize: 13, color: colors.ink700 },
  rowLineValue: { fontSize: 13, color: colors.navy, fontWeight: "600" },
  totalDivider: {
    height: 1, backgroundColor: colors.ink200, marginVertical: 8,
  },

  cta: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white, padding: spacing.lg, paddingBottom: spacing.xl,
    borderTopWidth: 1, borderTopColor: colors.ink100,
    ...shadows.card,
  },

  successIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.success, justifyContent: "center", alignItems: "center",
    marginTop: spacing.xl, ...shadows.card,
  },
  successTitle: { fontSize: 26, fontWeight: "700", color: colors.navy, marginTop: spacing.lg, letterSpacing: -0.5 },
  successSub: { fontSize: 14, color: colors.ink600, marginTop: 6, textAlign: "center", lineHeight: 20 },
});
