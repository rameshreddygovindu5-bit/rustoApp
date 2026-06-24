import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ScrollView, View, Text, StyleSheet, Image, Pressable,
  Alert, Animated, Easing, Dimensions, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  MapPin, BedDouble, Sparkles, CheckCircle2,
  ChevronLeft, ChevronRight, Heart, Star, Clock,
  Utensils, Shield, Wifi, Car,
} from "lucide-react-native";
import { colors, radius, shadows, spacing } from "@/theme";
import { Button, Card, DatePickerField, Eyebrow, Loading } from "@/components/UI";
import {
  rustoPublic, rustoBookings, rustoWishlist, RoomTypeAvail,
  Lodge, lodgeDisplayName, lodgeDescription, lodgeCheckinTime,
  lodgeCheckoutTime, lodgeStartingPrice,
} from "@/api/rusto";
import { razorpayCache } from "@/lib/razorpayCache";
import { useAuth } from "@/context/AuthContext";
import { inr, todayISO, addDays, nightsBetween, errorMessage } from "@/lib/format";

/**
 * Lodge detail screen — synced field-by-field with web RustoLodgeDetail.jsx.
 *
 * Data mapping (backend → screen):
 *   lodge.hotel_name | lodge.name      → title
 *   lodge.hotel_tagline                → subtitle
 *   lodge.hotel_description | .description → about section
 *   lodge.policies.checkin_time        → check-in display
 *   lodge.policies.checkout_time       → check-out display
 *   lodge.facilities.*                 → facility pills
 *   lodge.avg_rating                   → star rating badge
 *   lodge.photos[]                     → photo carousel
 *   lodge.room_types[]                 → room picker (pre-dates)
 *   availability.rooms[]               → room picker (with dates)
 */
export default function LodgeDetail() {
  const params = useLocalSearchParams();
  const code   = params.code as string;
  const router = useRouter();
  const { customer } = useAuth();

  const [lodge,        setLodge]        = useState<Lodge | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [availability, setAvailability] = useState<{ rooms: RoomTypeAvail[]; nights: number } | null>(null);
  const [saved,        setSaved]        = useState(false);
  const [savingWish,   setSavingWish]   = useState(false);
  const [reviews,      setReviews]      = useState<{ avg_rating: number | null; total: number }>(
    { avg_rating: null, total: 0 }
  );

  const [from,    setFrom]    = useState((params.from as string)   || todayISO());
  const [to,      setTo]      = useState((params.to as string)     || addDays(todayISO(), 2));
  const [rooms,   setRooms]   = useState(params.rooms  ? +(params.rooms  as string) : 1);
  const [guests,  setGuests]  = useState(params.guests ? +(params.guests as string) : 2);
  const [picked,  setPicked]  = useState<RoomTypeAvail | null>(null);
  const [photoIdx,setPhotoIdx]= useState(0);
  const [creating,setCreating]= useState(false);

  // Heart pop animation
  const heartScale = useRef(new Animated.Value(1)).current;
  const popHeart = () => {
    Animated.sequence([
      Animated.timing(heartScale, {
        toValue: 1.5, duration: 140,
        easing: Easing.out(Easing.back(2)), useNativeDriver: true,
      }),
      Animated.spring(heartScale, {
        toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8,
      }),
    ]).start();
  };

  // Load lodge + side data in parallel
  useEffect(() => {
    setLoading(true);
    Promise.all([
      rustoPublic.lodge(code),
      rustoPublic.reviews(code, { limit: 1 }),
    ]).then(([lodgeRes, reviewRes]) => {
      setLodge(lodgeRes.data);
      const rd = reviewRes.data;
      setReviews({ avg_rating: rd.avg_rating, total: rd.total });
    }).catch(() => setLodge(null))
      .finally(() => setLoading(false));

    // Wishlist check (non-blocking, only if logged in)
    if (customer) {
      rustoWishlist.check(code)
        .then(r => setSaved(r.data.saved ?? false))
        .catch(() => {});
    }
  }, [code, customer]);

  // Re-fetch availability whenever dates change
  useEffect(() => {
    if (!from || !to || new Date(from) >= new Date(to)) {
      setAvailability(null); return;
    }
    rustoPublic.availability(code, { from, to })
      .then(r => setAvailability(r.data))
      .catch(() => setAvailability(null));
  }, [code, from, to]);

  const validDates = from && to && new Date(from) < new Date(to);
  const nights     = useMemo(
    () => validDates ? nightsBetween(from, to) : 0,
    [from, to, validDates],
  );

  const photos = useMemo(() => {
    if (!lodge) return [];
    return lodge.photos?.length
      ? lodge.photos
      : lodge.cover_photo
        ? [{ url: lodge.cover_photo }]
        : [];
  }, [lodge]);

  const toggleWishlist = useCallback(async () => {
    if (!customer) {
      router.push({ pathname: "/signin", params: { next: `/lodges/${code}` } });
      return;
    }
    popHeart();
    const wasSaved = saved;
    setSaved(!wasSaved);
    setSavingWish(true);
    try {
      if (wasSaved) await rustoWishlist.unsave(code);
      else          await rustoWishlist.save(code);
    } catch {
      setSaved(wasSaved); // revert on error
    } finally { setSavingWish(false); }
  }, [customer, saved, code, router]);

  const onBook = async () => {
    if (!customer) {
      const nextUrl = `/lodges/${code}?from=${from}&to=${to}&rooms=${rooms}&guests=${guests}`;
      router.push({ pathname: "/signin", params: { next: nextUrl } });
      return;
    }
    if (!picked || !validDates) {
      Alert.alert("Select dates and a room type to continue"); return;
    }
    setCreating(true);
    try {
      const r = await rustoBookings.create({
        lodge_code:    code,
        room_type:     picked.type,
        rooms_count:   rooms,
        checkin_date:  from,
        checkout_date: to,
        adults:        guests,
        children:      0,
        contact_name:  customer.full_name || undefined,
        contact_phone: customer.phone     || undefined,
        contact_email: customer.email     || undefined,
      });
      razorpayCache.set(r.data.booking.booking_id, r.data.razorpay);
      router.push({
        pathname: "/checkout/[bookingId]",
        params: { bookingId: String(r.data.booking.booking_id) },
      } as any);
    } catch (e) {
      Alert.alert("Booking failed", errorMessage(e));
    } finally { setCreating(false); }
  };

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) return <Loading message="Loading lodge…"/>;
  if (!lodge)  return (
    <View style={styles.center}>
      <Text style={styles.notFound}>Lodge not found</Text>
      <Button title="Browse lodges" variant="primary"
               onPress={() => router.replace("/(tabs)/search" as any)}/>
    </View>
  );

  // ── Derived display values (synced with web) ──────────────────────────────
  const displayName  = lodgeDisplayName(lodge);
  const description  = lodgeDescription(lodge);
  const checkinTime  = lodgeCheckinTime(lodge);
  const checkoutTime = lodgeCheckoutTime(lodge);
  const startPrice   = lodgeStartingPrice(lodge);

  // Facility pills — same icons/labels as web RustoLodgeDetail
  const facilityPills: { label: string; Icon: any }[] = [];
  const f = lodge.facilities;
  if (f?.pool)           facilityPills.push({ label: "Pool",        Icon: Sparkles });
  if (f?.gym)            facilityPills.push({ label: "Gym",         Icon: Shield });
  if (f?.restaurant)     facilityPills.push({ label: "Restaurant",  Icon: Utensils });
  if (f?.parking || lodge.parking_available)
                         facilityPills.push({ label: "Parking",     Icon: Car });
  if (lodge.power_backup)facilityPills.push({ label: "Power backup",Icon: Sparkles });
  if (lodge.hot_water_24h)facilityPills.push({ label: "Hot water",  Icon: Sparkles });

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink50 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>

        {/* ── Photo carousel ──────────────────────────────────────────────── */}
        <View style={styles.photoWrap}>
          {photos[photoIdx]?.url ? (
            <Image
              source={{ uri: photos[photoIdx].url }}
              style={styles.photo}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Sparkles size={60} color="rgba(255,255,255,0.3)"/>
            </View>
          )}

          {photos.length > 1 && (
            <>
              <Pressable
                onPress={() => setPhotoIdx(i => (i - 1 + photos.length) % photos.length)}
                style={[styles.carouselBtn, { left: 10 }]}>
                <ChevronLeft size={18} color={colors.navyDark}/>
              </Pressable>
              <Pressable
                onPress={() => setPhotoIdx(i => (i + 1) % photos.length)}
                style={[styles.carouselBtn, { right: 10 }]}>
                <ChevronRight size={18} color={colors.navyDark}/>
              </Pressable>
              <View style={styles.photoCount}>
                <Text style={styles.photoCountText}>{photoIdx + 1} / {photos.length}</Text>
              </View>
            </>
          )}

          {/* Wishlist heart — same behaviour as web */}
          <Pressable
            onPress={toggleWishlist}
            disabled={savingWish}
            style={styles.wishBtn}
            accessibilityLabel={saved ? "Remove from wishlist" : "Save to wishlist"}>
            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <Heart
                size={20}
                color={saved ? colors.terracotta : "rgba(255,255,255,0.9)"}
                fill={saved ? colors.terracotta : "none"}
              />
            </Animated.View>
          </Pressable>
        </View>

        <View style={{ padding: spacing.lg }}>

          {/* ── Header ──────────────────────────────────────────────────────── */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{displayName}</Text>
              {lodge.hotel_tagline ? (
                <Text style={styles.tagline}>{lodge.hotel_tagline}</Text>
              ) : null}
              <View style={styles.locRow}>
                <MapPin size={13} color={colors.gold}/>
                <Text style={styles.locText} numberOfLines={2}>
                  {lodge.address
                    || `${lodge.city || lodge.public_city || ""}${lodge.state ? ", " + lodge.state : ""}`}
                </Text>
              </View>
            </View>

            {/* Rating badge — same as web */}
            {(reviews.avg_rating ?? lodge.avg_rating) != null && (
              <View style={styles.ratingBadge}>
                <Star size={12} color={colors.gold} fill={colors.gold}/>
                <Text style={styles.ratingText}>
                  {Number(reviews.avg_rating ?? lodge.avg_rating).toFixed(1)}
                </Text>
                {(reviews.total > 0 || lodge.review_count) && (
                  <Text style={styles.ratingCount}>
                    ({reviews.total || lodge.review_count})
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Property type + star pill */}
          {(lodge.property_type || lodge.property_category) && (
            <View style={styles.typePill}>
              <Text style={styles.typePillText}>
                {(lodge.property_category || lodge.property_type || "")
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (c: string) => c.toUpperCase())}
              </Text>
            </View>
          )}

          {/* Amenity chips */}
          {(lodge.amenities?.length ?? 0) > 0 && (
            <View style={styles.amenityRow}>
              {(lodge.amenities ?? []).slice(0, 6).map(a => (
                <View key={a} style={styles.amenity}>
                  <Text style={styles.amenityText}>{a.trim()}</Text>
                </View>
              ))}
              {(lodge.amenities?.length ?? 0) > 6 && (
                <View style={styles.amenity}>
                  <Text style={styles.amenityText}>
                    +{(lodge.amenities?.length ?? 0) - 6} more
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Facilities — from lodge.facilities (detail endpoint) */}
          {facilityPills.length > 0 && (
            <View style={styles.facilityRow}>
              {facilityPills.map(({ label, Icon }) => (
                <View key={label} style={styles.facilityPill}>
                  <Icon size={11} color={colors.goldDark}/>
                  <Text style={styles.facilityText}>{label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Description — hotel_description preferred (synced with web) */}
          {description ? (
            <Card style={{ marginTop: spacing.lg, padding: spacing.md }}>
              <Text style={styles.subhead}>About this lodge</Text>
              <Text style={styles.body}>{description}</Text>
            </Card>
          ) : null}

          {/* Check-in / Check-out — from lodge.policies (synced with web) */}
          <Card style={{ marginTop: spacing.md, padding: spacing.md }}>
            <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
              <View style={{ alignItems: "center", gap: 4 }}>
                <Clock size={16} color={colors.gold}/>
                <Text style={styles.infoLabel}>Check-in</Text>
                <Text style={styles.infoValue}>After {checkinTime}</Text>
              </View>
              <View style={{ width: 1, backgroundColor: colors.ink100 }}/>
              <View style={{ alignItems: "center", gap: 4 }}>
                <Clock size={16} color={colors.gold}/>
                <Text style={styles.infoLabel}>Check-out</Text>
                <Text style={styles.infoValue}>Before {checkoutTime}</Text>
              </View>
            </View>
          </Card>

          {/* Date pickers */}
          <View style={{ marginTop: spacing.xl }}>
            <Eyebrow>Select dates</Eyebrow>
            <View style={styles.datesRow}>
              <DatePickerField
                label="Check-in"  value={from} onChange={setFrom}
                minimumDate={new Date()}/>
              <DatePickerField
                label="Check-out" value={to}   onChange={setTo}
                minimumDate={from ? new Date(from) : new Date()}/>
            </View>
            <View style={styles.controlsRow}>
              <Stepper label="Rooms"  value={rooms}  setValue={setRooms}  min={1} max={10}/>
              <Stepper label="Guests" value={guests} setValue={setGuests} min={1} max={20}/>
            </View>
          </View>

          {/* Room types */}
          <View style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm }}>
              <BedDouble size={16} color={colors.gold}/>
              <Text style={styles.subhead}>Room types</Text>
            </View>

            {!validDates && (
              <Text style={styles.hint}>Pick dates above to see live availability.</Text>
            )}

            {(availability?.rooms || lodge.room_types || []).map((rt: any) => {
              const avail    = availability?.rooms?.find(r => r.type === rt.type);
              const tariff   = avail?.tariff_per_night ?? rt.base_tariff;
              const total    = avail?.estimated_total ?? (tariff ? tariff * (nights || 1) * rooms : null);
              const soldOut  = validDates && avail && avail.available < rooms;
              const selected = picked?.type === rt.type;
              const label    = rt.label || rt.type;

              return (
                <Pressable
                  key={rt.type}
                  disabled={!!soldOut}
                  onPress={() =>
                    setPicked({
                      type: rt.type, label,
                      tariff_per_night: tariff,
                      estimated_total:  total,
                      available:        avail?.available ?? 0,
                    })
                  }
                  style={[
                    styles.roomCard,
                    selected  && styles.roomCardSelected,
                    soldOut   && { opacity: 0.5 },
                  ]}>
                  {selected && (
                    <View style={styles.checkBadge}>
                      <CheckCircle2 size={14} color={colors.navyDark}/>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roomLabel}>{label}</Text>
                    <Text style={styles.roomMeta}>
                      {soldOut ? "Unavailable for selected dates"
                        : avail ? `${avail.available} available`
                        : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.roomTariffLabel}>per night</Text>
                    <Text style={styles.roomTariff}>{tariff ? inr(tariff) : "—"}</Text>
                    {total != null && nights > 0 && (
                      <Text style={styles.roomTotal}>{inr(total)} total</Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Nearby info */}
          {(lodge.bus_stand_km || lodge.railway_station_km) && (
            <Card style={{ marginTop: spacing.lg, padding: spacing.md }}>
              <Text style={styles.subhead}>Getting here</Text>
              {lodge.bus_stand_km && (
                <Text style={styles.body}>Bus stand: {lodge.bus_stand_km} km away</Text>
              )}
              {lodge.railway_station_km && (
                <Text style={styles.body}>Railway station: {lodge.railway_station_km} km away</Text>
              )}
            </Card>
          )}
        </View>
      </ScrollView>

      {/* ── Sticky booking CTA ────────────────────────────────────────────── */}
      <View style={styles.cta}>
        <View style={{ flex: 1 }}>
          <Text style={styles.ctaLabel}>
            {picked ? picked.label : "Select a room type"}
          </Text>
          <Text style={styles.ctaPrice}>
            {picked?.tariff_per_night
              ? inr(picked.tariff_per_night) + "/night"
              : startPrice
                ? "from " + inr(startPrice) + "/night"
                : ""}
          </Text>
        </View>
        <View style={{ minWidth: 120 }}>
          <Button
            title={creating ? "Booking…" : "Book now"}
            variant="gold"
            loading={creating}
            disabled={!picked || !validDates || creating}
            onPress={onBook}
          />
        </View>
      </View>
    </View>
  );
}

// ── Stepper ──────────────────────────────────────────────────────────────────
function Stepper({ label, value, setValue, min, max }: {
  label: string; value: number; setValue: (n: number) => void;
  min: number; max: number;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable onPress={() => setValue(Math.max(min, value - 1))} style={styles.stepperBtn}>
          <Text style={styles.stepperSign}>−</Text>
        </Pressable>
        <Text style={styles.stepperVal}>{value}</Text>
        <Pressable onPress={() => setValue(Math.min(max, value + 1))} style={styles.stepperBtn}>
          <Text style={styles.stepperSign}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center:   { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl },
  notFound: { fontSize: 18, fontWeight: "700", color: colors.navy, marginBottom: spacing.lg },

  photoWrap: { height: Math.round(Dimensions.get('window').width * 0.65), backgroundColor: colors.navyDark, position: "relative" },
  photo:     { width: "100%", height: "100%" },
  photoPlaceholder: {
    width: "100%", height: "100%",
    justifyContent: "center", alignItems: "center", backgroundColor: colors.navy,
  },
  carouselBtn: {
    position: "absolute", top: "50%", marginTop: -18,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(253,250,243,0.90)",
    justifyContent: "center", alignItems: "center",
    ...shadows.soft,
  },
  photoCount: {
    position: "absolute", bottom: 10, right: 10,
    backgroundColor: "rgba(7,19,28,0.65)",
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  photoCountText: { fontSize: 11, color: colors.white, fontWeight: "600" },
  wishBtn: {
    position: "absolute", top: 12, right: 12,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "rgba(7,19,28,0.55)",
    justifyContent: "center", alignItems: "center",
    ...shadows.soft,
  },

  headerRow:   { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title:       { fontSize: 22, fontWeight: "800", color: colors.navy, letterSpacing: -0.5 },
  tagline:     { fontSize: 13, color: colors.goldDark, fontStyle: "italic", marginTop: 2 },
  locRow:      { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  locText:     { fontSize: 13, color: colors.ink500, flex: 1, lineHeight: 18 },

  ratingBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.goldGlow, borderRadius: radius.sm,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.goldLight,
  },
  ratingText:  { fontSize: 13, fontWeight: "800", color: colors.navy },
  ratingCount: { fontSize: 11, color: colors.ink500 },

  typePill: {
    alignSelf: "flex-start", marginTop: 6,
    backgroundColor: colors.navyDark,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full,
  },
  typePillText: {
    fontSize: 10, fontWeight: "700", color: colors.goldLight,
    letterSpacing: 0.6, textTransform: "uppercase",
  },

  amenityRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
  amenity:    {
    backgroundColor: colors.ink100, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.sm,
  },
  amenityText:{ fontSize: 11, color: colors.ink700, fontWeight: "600" },

  facilityRow:{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
  facilityPill:{
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.goldGlow, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.goldLight,
  },
  facilityText:{ fontSize: 11, color: colors.goldDark, fontWeight: "600" },

  infoLabel: {
    fontSize: 10, color: colors.ink400, fontWeight: "700",
    letterSpacing: 1, textTransform: "uppercase",
  },
  infoValue: { fontSize: 14, fontWeight: "700", color: colors.navy },

  subhead: { fontSize: 16, fontWeight: "700", color: colors.navy },
  body:    { fontSize: 14, color: colors.ink700, lineHeight: 22, marginTop: 6 },
  hint:    {
    fontSize: 12, color: colors.ink500, backgroundColor: colors.ink100,
    padding: 12, borderRadius: 10, marginBottom: 10,
  },

  datesRow:    { flexDirection: "row", gap: 8, marginTop: 8 },
  controlsRow: { flexDirection: "row", gap: 8, marginTop: 8 },

  stepperLabel: {
    fontSize: 10, color: colors.ink500, fontWeight: "600",
    letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4,
  },
  stepper: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.ink200,
    borderRadius: radius.md, paddingHorizontal: 4, paddingVertical: 2,
  },
  stepperBtn: { width: 32, height: 32, justifyContent: "center", alignItems: "center" },
  stepperSign:{ fontSize: 18, fontWeight: "700", color: colors.navy },
  stepperVal: {
    fontSize: 15, fontWeight: "700", color: colors.navy,
    minWidth: 24, textAlign: "center",
  },

  roomCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.ink200,
    padding: spacing.md, borderRadius: radius.md, marginBottom: 8,
    position: "relative",
  },
  roomCardSelected: { borderColor: colors.gold, backgroundColor: colors.goldGlow },
  roomLabel:     { fontSize: 15, fontWeight: "700", color: colors.navy },
  roomMeta:      {
    fontSize: 11, color: colors.ink500, marginTop: 2,
    textTransform: "uppercase", letterSpacing: 0.6, fontWeight: "600",
  },
  roomTariffLabel: { fontSize: 10, color: colors.ink500 },
  roomTariff:    { fontSize: 18, fontWeight: "700", color: colors.navy },
  roomTotal:     { fontSize: 10, color: colors.ink500, marginTop: 2 },
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
    padding: spacing.lg,
    paddingBottom: Platform.OS === "ios" ? 34 : spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.ink100,
    ...shadows.card,
  },
  ctaLabel: {
    fontSize: 11, color: colors.ink500, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  ctaPrice: { fontSize: 20, fontWeight: "700", color: colors.navy },
});
