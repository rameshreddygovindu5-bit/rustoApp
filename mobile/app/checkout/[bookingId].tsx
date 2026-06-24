import React, { useState, useEffect } from "react";
import { ScrollView, View, Text, StyleSheet, Alert, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, MapPin, CreditCard, Shield, AlertCircle } from "lucide-react-native";
import { colors, radius, spacing, shadows } from "@/theme";
import { Button, Card, Eyebrow, Input, Loading } from "@/components/UI";
import { useAuth } from "@/context/AuthContext";
import { rustoBookings, Booking, RazorpayOrderPayload } from "@/api/rusto";
import { inr, errorMessage } from "@/lib/format";

/**
 * Checkout screen — finalize an existing booking via Razorpay.
 *
 * FIXED: No longer re-creates a booking to get payment details.
 * The razorpay payload is passed from the lodge-detail screen via a
 * module-level cache keyed on booking_id. This is safe because:
 *   1. The lodge-detail screen creates the booking, gets the payload, and 
 *      stores it here before navigating.
 *   2. The booking_id is passed as a route param for fetching booking details.
 *   3. If the cache is empty (deep link / app restart), we show a degraded view
 *      with the booking details but no payment button (user must re-book).
 */

// Razorpay payload cache (shared with lodge-detail screen via razorpayCache module)
import { razorpayCache as RAZORPAY_CACHE } from "@/lib/razorpayCache";

export default function Checkout() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router  = useRouter();
  const { customer } = useAuth();

  const [booking,   setBooking]   = useState<Booking | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [paying,    setPaying]    = useState(false);
  const [done,      setDone]      = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoMsg,  setPromoMsg]  = useState<{text:string;ok:boolean}|null>(null);
  const [applyingPromo, setApplyingPromo] = useState(false);

  const bid = parseInt(bookingId ?? "0", 10);
  const rzp = RAZORPAY_CACHE.get(bid) ?? null;

  useEffect(() => {
    let cancelled = false;
    rustoBookings.get(bid)
      .then(r => { if (!cancelled) setBooking(r.data); })
      .catch(e => Alert.alert("Could not load booking", errorMessage(e)))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bid]);

  const applyPromo = async () => {
    if (!booking || !promoCode.trim()) return;
    setApplyingPromo(true);
    setPromoMsg(null);
    try {
      const r = await rustoBookings.applyPromo(bid, promoCode.trim().toUpperCase());
      setBooking((r.data as any).booking);
      setPromoMsg({ text: "Promo applied! Discount added.", ok: true });
    } catch (e) {
      setPromoMsg({ text: errorMessage(e, "Invalid promo code"), ok: false });
    } finally { setApplyingPromo(false); }
  };

  const handlePay = async () => {
    if (!booking) return;
    if (!rzp) {
      Alert.alert(
        "Payment session expired",
        "Please go back and create a new booking to proceed with payment.",
        [{ text: "OK" }]
      );
      return;
    }
    setPaying(true);
    try {
      if (rzp.is_mock) {
        // Mock mode — works in Expo Go without native modules
        const r = await rustoBookings.verifyPayment(bid, {
          razorpay_order_id:   rzp.order_id,
          razorpay_payment_id: "pay_mock_" + Date.now(),
          razorpay_signature:  "mock_signature",
        });
        setBooking((r.data as any).booking);
        setDone(true);
        RAZORPAY_CACHE.delete(bid);
      } else {
        await openRazorpayCheckout(booking, rzp);
      }
    } catch (e) {
      Alert.alert("Payment failed", errorMessage(e));
    } finally { setPaying(false); }
  };

  async function openRazorpayCheckout(b: Booking, payload: RazorpayOrderPayload) {
    let RazorpayCheckout: any;
    try { RazorpayCheckout = require("react-native-razorpay").default; }
    catch {
      Alert.alert(
        "Live payments not available in Expo Go",
        "Run expo prebuild and start a dev client to enable Razorpay. See mobile/README.md."
      );
      return;
    }
    const options = {
      key:         payload.key_id,
      order_id:    payload.order_id,
      amount:      payload.amount,
      currency:    payload.currency,
      name:        payload.name,
      description: payload.description,
      prefill:     payload.prefill,
      theme:       { color: colors.gold },
    };
    try {
      const data = await RazorpayCheckout.open(options);
      const r = await rustoBookings.verifyPayment(b.booking_id, {
        razorpay_order_id:   data.razorpay_order_id,
        razorpay_payment_id: data.razorpay_payment_id,
        razorpay_signature:  data.razorpay_signature,
      });
      setBooking((r.data as any).booking);
      setDone(true);
      RAZORPAY_CACHE.delete(bid);
    } catch (e: any) {
      if (e?.code !== 0) Alert.alert("Payment cancelled", e?.description || "Payment was not completed");
    }
  }

  if (loading) return <Loading message="Loading booking..."/>;
  if (!booking) return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl }}>
      <AlertCircle size={36} color={colors.danger}/>
      <Text style={styles.notFound}>Booking not found</Text>
      <Button title="Go back" variant="outline"
               onPress={() => router.back()}/>
    </View>
  );

  // Confirmation view
  if (done || booking.status === "confirmed") return (
    <ScrollView contentContainerStyle={{ padding: spacing.xl, alignItems: "center", paddingTop: spacing.huge }}>
      <View style={styles.successIcon}>
        <CheckCircle2 size={42} color={colors.white}/>
      </View>
      <Text style={styles.successTitle}>Booking confirmed!</Text>
      <Text style={styles.successSub}>
        Your stay at <Text style={{ fontWeight: "700" }}>
          {booking.lodge?.display_name || booking.lodge?.name || "the lodge"}
        </Text> is locked in.
      </Text>
      <Card style={{ marginTop: spacing.xl, alignSelf: "stretch" }}>
        <Row label="Booking ref" value={booking.booking_ref} mono/>
        <Row label="Check-in"    value={booking.checkin_date}/>
        <Row label="Check-out"   value={booking.checkout_date}/>
        <Row label="Room"        value={booking.room_type_label + " x " + booking.rooms_count}/>
        <Row label="Total paid"  value={inr(booking.total_amount)} highlight/>
      </Card>
      <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.xl, alignSelf: "stretch" }}>
        <View style={{ flex: 1 }}>
          <Button title="My bookings" variant="primary" fullWidth
                   onPress={() => router.replace("/(tabs)/account" as any)}/>
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Browse more" variant="outline" fullWidth
                   onPress={() => router.replace("/(tabs)" as any)}/>
        </View>
      </View>
    </ScrollView>
  );

  // Payment pending view
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink50 }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
        <Eyebrow>Checkout</Eyebrow>
        <Text style={styles.title}>Review & pay</Text>

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={styles.lodgeName}>{booking.lodge?.display_name || booking.lodge?.name || "Lodge"}</Text>
          {booking.lodge?.city && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
              <MapPin size={11} color={colors.ink500}/>
              <Text style={styles.lodgeLoc}>
                {booking.lodge.city}{booking.lodge.state ? ", " + booking.lodge.state : ""}
              </Text>
            </View>
          )}
          <View style={{ marginTop: spacing.md }}>
            <Row label="Check-in"   value={booking.checkin_date}/>
            <Row label="Check-out"  value={booking.checkout_date}/>
            <Row label="Nights"     value={String(booking.nights)}/>
            <Row label="Guests"     value={booking.adults + " adult" + (booking.adults > 1 ? "s" : "")}/>
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
          {booking.contact_email && <Row label="Email" value={booking.contact_email}/>}
        </Card>

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={styles.subhead}>Promo code</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Input
                value={promoCode}
                onChangeText={v => { setPromoCode(v.toUpperCase()); setPromoMsg(null); }}
                placeholder="Enter promo code"
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
            <View style={{ marginBottom: spacing.md }}>
              <Button title="Apply" variant="outline" small loading={applyingPromo} onPress={applyPromo}/>
            </View>
          </View>
          {promoMsg && (
            <Text style={{ fontSize: 12, color: promoMsg.ok ? colors.success : colors.danger, marginTop: -spacing.sm }}>
              {promoMsg.text}
            </Text>
          )}
        </Card>

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={styles.subhead}>Price breakdown</Text>
          <View style={{ marginTop: spacing.sm }}>
            <RowLine
              label={inr(booking.tariff_per_night) + " x " + booking.rooms_count + " x " + booking.nights + "n"}
              value={inr(booking.subtotal)}
            />
            {booking.promo_discount > 0 && (
              <RowLine label={"Promo (" + (booking.promo_code || "") + ")"} value={"-" + inr(booking.promo_discount)} muted/>
            )}
            {booking.gst_amount > 0 && (
              <RowLine label="GST" value={inr(booking.gst_amount)} muted/>
            )}
            <View style={styles.totalDivider}/>
            <RowLine label="Total" value={inr(booking.total_amount)} bold/>
          </View>
        </Card>

        {!rzp && booking.status === "payment_pending" && (
          <View style={{ marginTop: spacing.lg, padding: spacing.md,
                          backgroundColor: colors.warningBg, borderRadius: radius.md }}>
            <Text style={{ fontSize: 13, color: "#92400E" }}>
              Payment session expired. Please go back and create a new booking to pay.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.cta}>
        <Button
          title={paying ? "Opening payment..." : "Pay " + inr(booking.total_amount)}
          variant="gold"
          fullWidth
          loading={paying}
          disabled={!rzp && booking.status === "payment_pending"}
          icon={<CreditCard size={14} color={colors.navyDark}/>}
          onPress={handlePay}
        />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center",
                       gap: 4, marginTop: 6 }}>
          <Shield size={10} color={colors.success}/>
          <Text style={{ fontSize: 10, color: colors.ink500 }}>Secure payment via Razorpay</Text>
        </View>
      </View>
    </View>
  );
}

function Row({ label, value, highlight, mono }: {
  label: string; value: string | number; highlight?: boolean; mono?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue,
                     highlight && { color: colors.goldDark, fontWeight: "700" },
                     mono && { fontFamily: "monospace" }]}>
        {value}
      </Text>
    </View>
  );
}

function RowLine({ label, value, bold, muted }: {
  label: string; value: string; bold?: boolean; muted?: boolean;
}) {
  return (
    <View style={[styles.rowLine, muted && { opacity: 0.7 }]}>
      <Text style={[styles.rowLineLabel, bold && { fontWeight: "700", color: colors.navy }]}>{label}</Text>
      <Text style={[styles.rowLineValue, bold && { color: colors.goldDark, fontWeight: "700", fontSize: 16 }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notFound:   { fontSize: 16, fontWeight: "700", color: colors.navy, marginTop: spacing.md, marginBottom: spacing.lg },
  title:      { fontSize: 24, fontWeight: "700", color: colors.navy, marginTop: 4, letterSpacing: -0.5 },
  subhead:    { fontSize: 14, fontWeight: "700", color: colors.navy, marginBottom: spacing.sm },
  lodgeName:  { fontSize: 17, fontWeight: "700", color: colors.navy },
  lodgeLoc:   { fontSize: 12, color: colors.ink500 },
  row:        { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  rowLabel:   { fontSize: 13, color: colors.ink500 },
  rowValue:   { fontSize: 13, color: colors.navy, fontWeight: "600" },
  rowLine:    { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  rowLineLabel:{ fontSize: 13, color: colors.ink700 },
  rowLineValue:{ fontSize: 13, color: colors.navy, fontWeight: "600" },
  totalDivider:{ height: 1, backgroundColor: colors.ink200, marginVertical: 8 },
  cta: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white, padding: spacing.lg,
    paddingBottom: Platform.OS === "ios" ? 34 : spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.ink100, ...shadows.card,
  },
  successIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.success,
    justifyContent: "center", alignItems: "center", marginTop: spacing.xl, ...shadows.card,
  },
  successTitle:{ fontSize: 26, fontWeight: "700", color: colors.navy, marginTop: spacing.lg, letterSpacing: -0.5 },
  successSub:  { fontSize: 14, color: colors.ink600, marginTop: 6, textAlign: "center", lineHeight: 20 },
});
