import React, { useState, useEffect, useMemo } from "react";
import {
  ScrollView, View, Text, StyleSheet, Image, Pressable, Alert, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MapPin, BedDouble, Calendar, Sparkles,
         CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { colors, radius, shadows, spacing } from "@/theme";
import { Button, Card, Eyebrow, Loading } from "@/components/UI";
import { rustoPublic, rustoBookings, RoomTypeAvail } from "@/api/rusto";
import { useAuth } from "@/context/AuthContext";
import { inr, todayISO, addDays, nightsBetween, errorMessage } from "@/lib/format";

/**
 * Lodge detail. Anatomy:
 *   - Photo carousel (swipe left/right buttons; full-bleed top)
 *   - Lodge header (name, location, amenities)
 *   - Description card
 *   - Date pickers + room type cards
 *   - Sticky "Book now" CTA at the bottom
 *
 * When the customer taps Book:
 *   - Not logged in → redirect to /signin?next=<this URL>
 *   - Logged in     → POST /api/rusto/bookings, push to /checkout/<id>
 *                     with the booking + razorpay payload in state-equivalent
 *                     (params can't carry objects, so we re-fetch in checkout).
 */
export default function LodgeDetail() {
  const params = useLocalSearchParams();
  const code = params.code as string;
  const router = useRouter();
  const { customer } = useAuth();

  const [lodge, setLodge] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [availability, setAvailability] = useState<{ rooms: RoomTypeAvail[]; nights: number } | null>(null);

  const [from, setFrom]     = useState((params.from as string) || todayISO());
  const [to,   setTo]       = useState((params.to as string)   || addDays(todayISO(), 2));
  const [rooms, setRooms]   = useState(params.rooms  ? +(params.rooms as string)  : 1);
  const [guests, setGuests] = useState(params.guests ? +(params.guests as string) : 2);
  const [showFrom, setShowFrom] = useState(false);
  const [showTo,   setShowTo]   = useState(false);
  const [picked, setPicked] = useState<RoomTypeAvail | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [creating, setCreating] = useState(false);

  // Fetch lodge once on mount.
  useEffect(() => {
    setLoading(true);
    rustoPublic.lodge(code).then(r => setLodge(r.data))
      .catch(() => setLodge(null)).finally(() => setLoading(false));
  }, [code]);

  // Re-fetch availability whenever the dates change.
  useEffect(() => {
    if (!from || !to || from >= to) { setAvailability(null); return; }
    rustoPublic.availability(code, { from, to })
      .then(r => setAvailability(r.data))
      .catch(() => setAvailability(null));
  }, [code, from, to]);

  const validDates = from && to && from < to;
  const nights = useMemo(() => validDates ? nightsBetween(from, to) : 0, [from, to, validDates]);

  const photos = useMemo(() => {
    if (!lodge) return [];
    return (lodge.photos?.length ? lodge.photos
            : (lodge.cover_photo ? [{ url: lodge.cover_photo }] : []));
  }, [lodge]);

  const onBook = async () => {
    if (!customer) {
      const nextUrl = `/lodges/${code}?from=${from}&to=${to}&rooms=${rooms}&guests=${guests}`;
      router.push({ pathname: "/signin", params: { next: nextUrl } });
      return;
    }
    if (!picked || !validDates) {
      Alert.alert("Pick dates and a room type to book"); return;
    }
    setCreating(true);
    try {
      const r = await rustoBookings.create({
        lodge_code: code, room_type: picked.type, rooms_count: rooms,
        checkin_date: from, checkout_date: to,
        adults: guests, children: 0,
      });
      router.push({
        pathname: "/checkout/[bookingId]",
        params: { bookingId: String(r.data.booking.booking_id) },
      });
    } catch (e) {
      Alert.alert("Booking failed", errorMessage(e));
    } finally { setCreating(false); }
  };

  if (loading) return <Loading message="Loading lodge…"/>;
  if (!lodge) return (
    <View style={styles.center}>
      <Text style={styles.notFound}>Lodge not found</Text>
      <Button title="Browse lodges" variant="primary"
               onPress={() => router.replace("/(tabs)/search")}/>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink50 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        {/* Photo carousel */}
        <View style={styles.photoWrap}>
          {photos[photoIdx]?.url ? (
            <Image source={{ uri: photos[photoIdx].url }} style={styles.photo} resizeMode="cover"/>
          ) : (
            <View style={styles.photoPlaceholder}>
              <Sparkles size={60} color="rgba(255,255,255,0.3)"/>
            </View>
          )}
          {photos.length > 1 && (
            <>
              <Pressable onPress={() => setPhotoIdx(i => (i - 1 + photos.length) % photos.length)}
                          style={[styles.carouselBtn, { left: 10 }]}>
                <ChevronLeft size={18} color={colors.navyDark}/>
              </Pressable>
              <Pressable onPress={() => setPhotoIdx(i => (i + 1) % photos.length)}
                          style={[styles.carouselBtn, { right: 10 }]}>
                <ChevronRight size={18} color={colors.navyDark}/>
              </Pressable>
              <View style={styles.photoCount}>
                <Text style={styles.photoCountText}>{photoIdx + 1} / {photos.length}</Text>
              </View>
            </>
          )}
        </View>

        <View style={{ padding: spacing.lg }}>
          {/* Header */}
          <Text style={styles.title}>{lodge.name}</Text>
          <View style={styles.locRow}>
            <MapPin size={13} color={colors.gold}/>
            <Text style={styles.locText} numberOfLines={2}>
              {lodge.address || `${lodge.city || ""}${lodge.state ? ", " + lodge.state : ""}`}
            </Text>
          </View>
          {lodge.amenities?.length > 0 && (
            <View style={styles.amenityRow}>
              {lodge.amenities.map((a: string) => (
                <View key={a} style={styles.amenity}>
                  <Text style={styles.amenityText}>{a.trim()}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Description */}
          {lodge.description ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text style={styles.subhead}>About this lodge</Text>
              <Text style={styles.body}>{lodge.description}</Text>
            </Card>
          ) : null}

          {/* Date pickers */}
          <View style={{ marginTop: spacing.xl }}>
            <Eyebrow>Pick dates</Eyebrow>
            <View style={styles.datesRow}>
              <DateField label="Check-in" value={from}
                          onPress={() => setShowFrom(true)}/>
              <DateField label="Check-out" value={to}
                          onPress={() => setShowTo(true)}/>
            </View>
            <View style={styles.controlsRow}>
              <Stepper label="Rooms" value={rooms} setValue={setRooms} min={1} max={10}/>
              <Stepper label="Guests" value={guests} setValue={setGuests} min={1} max={20}/>
            </View>
          </View>

          {/* Room types */}
          <View style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm }}>
              <BedDouble size={16} color={colors.gold}/>
              <Text style={styles.subhead}>Rooms</Text>
            </View>
            {!validDates && (
              <Text style={styles.hint}>Pick valid dates above to see live availability.</Text>
            )}
            {(availability?.rooms || lodge.room_types || []).map((rt: any) => {
              const avail = availability?.rooms?.find(r => r.type === rt.type);
              const tariff = avail?.tariff_per_night ?? rt.base_tariff;
              const total = avail?.estimated_total ?? (tariff ? tariff * (nights || 1) * rooms : null);
              const sold = validDates && avail && avail.available < rooms;
              const selected = picked?.type === rt.type;
              const label = rt.label || rt.type;

              return (
                <Pressable key={rt.type} disabled={!!sold}
                            onPress={() => setPicked({ type: rt.type, label, tariff_per_night: tariff,
                                                        estimated_total: total, available: avail?.available ?? 0 })}
                            style={[
                              styles.roomCard,
                              selected && styles.roomCardSelected,
                              sold && { opacity: 0.5 },
                            ]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.roomLabel}>{label}</Text>
                    <Text style={styles.roomMeta}>
                      {validDates && avail
                        ? (avail.available > 0 ? `${avail.available} available` : "Sold out")
                        : `${rt.total_rooms || 0} rooms total`}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    {tariff && (
                      <>
                        <Text style={styles.roomTariffLabel}>per night</Text>
                        <Text style={styles.roomTariff}>{inr(tariff)}</Text>
                        {nights > 0 && total && (
                          <Text style={styles.roomTotal}>Total {inr(total)} · {nights}n</Text>
                        )}
                      </>
                    )}
                  </View>
                  {selected && (
                    <View style={styles.checkBadge}>
                      <CheckCircle2 size={14} color={colors.white}/>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Date pickers (rendered conditionally; Android shows native modal) */}
      {showFrom && (
        <DateTimePicker mode="date" value={new Date(from)} minimumDate={new Date()}
                        onChange={(_, d) => {
                          setShowFrom(Platform.OS === "ios");
                          if (d) setFrom(d.toISOString().slice(0, 10));
                        }}/>
      )}
      {showTo && (
        <DateTimePicker mode="date" value={new Date(to)} minimumDate={new Date(from || todayISO())}
                        onChange={(_, d) => {
                          setShowTo(Platform.OS === "ios");
                          if (d) setTo(d.toISOString().slice(0, 10));
                        }}/>
      )}

      {/* Sticky bottom Book CTA */}
      <View style={styles.cta}>
        <View style={{ flex: 1 }}>
          {picked && nights > 0 ? (
            <>
              <Text style={styles.ctaLabel}>{nights} night{nights > 1 ? "s" : ""} · {rooms} room{rooms > 1 ? "s" : ""}</Text>
              <Text style={styles.ctaPrice}>{inr((picked.tariff_per_night || 0) * rooms * nights)}</Text>
            </>
          ) : (
            <Text style={styles.ctaLabel}>Pick dates &amp; a room</Text>
          )}
        </View>
        <Button
          title={!customer ? "Sign in to book" :
                  !picked  ? "Pick a room"  :
                  !validDates ? "Pick dates" : "Book now"}
          variant="gold"
          loading={creating}
          disabled={!picked || !validDates}
          onPress={onBook}/>
      </View>
    </View>
  );
}


function DateField({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <View style={styles.dateField}>
        <Calendar size={14} color={colors.gold}/>
        <View style={{ marginLeft: 8 }}>
          <Text style={styles.dateLabel}>{label}</Text>
          <Text style={styles.dateValue}>{value}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function Stepper({ label, value, setValue, min, max }:
                  { label: string; value: number; setValue: (n: number) => void; min: number; max: number }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.dateLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable onPress={() => setValue(Math.max(min, value - 1))}
                    style={styles.stepperBtn}>
          <Text style={styles.stepperSign}>−</Text>
        </Pressable>
        <Text style={styles.stepperVal}>{value}</Text>
        <Pressable onPress={() => setValue(Math.min(max, value + 1))}
                    style={styles.stepperBtn}>
          <Text style={styles.stepperSign}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl },
  notFound: { fontSize: 18, fontWeight: "700", color: colors.navy, marginBottom: spacing.md },

  photoWrap: { aspectRatio: 16/10, backgroundColor: colors.navyDark, position: "relative" },
  photo: { width: "100%", height: "100%" },
  photoPlaceholder: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.navy },
  carouselBtn: {
    position: "absolute", top: "50%", marginTop: -16,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.9)",
    justifyContent: "center", alignItems: "center",
    ...shadows.soft,
  },
  photoCount: {
    position: "absolute", bottom: 10, right: 10,
    backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  photoCountText: { color: colors.white, fontSize: 10, fontWeight: "700" },

  title: { fontSize: 26, fontWeight: "700", color: colors.navy, letterSpacing: -0.5 },
  locRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  locText: { fontSize: 13, color: colors.ink600, flex: 1 },
  amenityRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  amenity: { backgroundColor: colors.ink50, borderColor: colors.ink100, borderWidth: 1,
              paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  amenityText: { fontSize: 12, color: colors.ink700 },

  subhead: { fontSize: 16, fontWeight: "700", color: colors.navy },
  body: { fontSize: 14, color: colors.ink700, lineHeight: 22, marginTop: 6 },
  hint: { fontSize: 12, color: colors.ink500, backgroundColor: colors.ink100,
           padding: 12, borderRadius: 10, marginBottom: 10 },

  datesRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  controlsRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  dateField: {
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.ink200,
    paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md,
    flexDirection: "row", alignItems: "center",
  },
  dateLabel: { fontSize: 10, color: colors.ink500, fontWeight: "700",
                textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  dateValue: { fontSize: 13, color: colors.navy, fontWeight: "600" },

  stepper: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.ink200,
    borderRadius: radius.md, paddingHorizontal: 4, paddingVertical: 2,
  },
  stepperBtn: { width: 32, height: 32, justifyContent: "center", alignItems: "center" },
  stepperSign: { fontSize: 18, fontWeight: "700", color: colors.navy },
  stepperVal: { fontSize: 15, fontWeight: "700", color: colors.navy },

  roomCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink200,
    padding: spacing.md, borderRadius: radius.md, marginBottom: 8,
    position: "relative",
  },
  roomCardSelected: { borderColor: colors.gold, backgroundColor: colors.goldGlow },
  roomLabel: { fontSize: 15, fontWeight: "700", color: colors.navy },
  roomMeta: { fontSize: 11, color: colors.ink500, marginTop: 2,
               textTransform: "uppercase", letterSpacing: 0.6, fontWeight: "600" },
  roomTariffLabel: { fontSize: 10, color: colors.ink500 },
  roomTariff: { fontSize: 18, fontWeight: "700", color: colors.navy },
  roomTotal: { fontSize: 10, color: colors.ink500, marginTop: 2 },
  checkBadge: {
    position: "absolute", top: -6, right: -6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.gold, justifyContent: "center", alignItems: "center",
    ...shadows.soft,
  },

  cta: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white,
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: spacing.lg, paddingBottom: spacing.xl,
    borderTopWidth: 1, borderTopColor: colors.ink100,
    ...shadows.card,
  },
  ctaLabel: { fontSize: 11, color: colors.ink500, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  ctaPrice: { fontSize: 22, fontWeight: "700", color: colors.navy },
});
