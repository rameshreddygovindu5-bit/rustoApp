/**
 * LodgeCard v2 — "Indian Dusk" design.
 * Animated press scale + fade, gold price badge, wishlist heart with spring pop.
 */
import React, { useRef, useCallback } from "react";
import {
  Animated, Easing, Pressable, View, Text, StyleSheet, Image,
} from "react-native";
import { useRouter } from "expo-router";
import { MapPin, Star, Heart, Sparkles } from "lucide-react-native";
import { colors, radius, shadows, spacing, timing } from "@/theme";
import { Lodge, lodgeDisplayName, lodgeStartingPrice } from "@/api/rusto";
import { inr } from "@/lib/format";
import { Pill } from "@/components/UI";

interface Props {
  lodge: Lodge;
  query?: { from?: string; to?: string; rooms?: number; guests?: number };
  saved?: boolean;
  onSave?: (code: string) => void;
}

export function LodgeCard({ lodge, query, saved = false, onSave }: Props) {
  const router = useRouter();
  const scale      = useRef(new Animated.Value(1)).current;
  const heartScale = useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    Animated.spring(scale, {
      toValue: 0.975, useNativeDriver: true, speed: 50, bounciness: 2,
    }).start();
  };
  const onPressOut = () => {
    Animated.spring(scale, {
      toValue: 1, useNativeDriver: true, speed: 50, bounciness: 6,
    }).start();
  };

  const onPress = () => {
    const params: Record<string, string> = {};
    if (query?.from)   params.from   = query.from;
    if (query?.to)     params.to     = query.to;
    if (query?.rooms)  params.rooms  = String(query.rooms);
    if (query?.guests) params.guests = String(query.guests);
    router.push({ pathname: "/lodges/[code]", params: { code: lodge.code, ...params } });
  };

  const handleSave = useCallback(() => {
    if (!onSave) return;
    // Spring pop the heart
    Animated.sequence([
      Animated.timing(heartScale, {
        toValue: 1.5, duration: 140,
        easing: Easing.out(Easing.back(2)),
        useNativeDriver: true,
      }),
      Animated.spring(heartScale, {
        toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8,
      }),
    ]).start();
    onSave(lodge.code);
  }, [onSave, lodge.code, heartScale]);

  const hasPhoto = Boolean(lodge.cover_photo);
  const price    = lodgeStartingPrice(lodge);
  const type     = (lodge.property_category || lodge.property_type || "lodge").replace(/_/g, " ");
  const rating   = typeof lodge.avg_rating === "number" ? lodge.avg_rating : null;
  const name     = lodgeDisplayName(lodge);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={`${lodge.name} in ${lodge.city ?? ""}`}>
      <Animated.View style={[styles.card, { transform: [{ scale }] }]}>

        {/* ── Photo ─── */}
        <View style={styles.imageWrap}>
          {hasPhoto ? (
            <Image
              source={{ uri: lodge.cover_photo! }}
              style={styles.image}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Sparkles size={36} color="rgba(232,160,32,0.4)"/>
            </View>
          )}

          {/* Gradient overlay — stacked layers simulate bottom-to-top dark gradient */}
          <View style={[styles.gradLayer1, { pointerEvents: "none" }]}/>
          <View style={[styles.gradLayer2, { pointerEvents: "none" }]}/>
          <View style={[styles.gradLayer3, { pointerEvents: "none" }]}/>

          {/* Property type pill */}
          <View style={styles.typePill}>
            <Text style={styles.typePillText}>{type}</Text>
          </View>

          {/* Rating badge */}
          {rating != null && (
            <View style={styles.ratingBadge}>
              <Star size={10} color={colors.gold} fill={colors.gold}/>
              <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
            </View>
          )}

          {/* Heart button */}
          {onSave && (
            <Pressable style={styles.heartBtn} onPress={handleSave}
              accessibilityLabel={saved ? "Remove from wishlist" : "Save to wishlist"}>
              <Animated.View style={{ transform: [{ scale: heartScale }] }}>
                <Heart
                  size={16}
                  color={saved ? colors.terracotta : "rgba(255,255,255,0.9)"}
                  fill={saved ? colors.terracotta : "none"}
                />
              </Animated.View>
            </Pressable>
          )}

          {/* Price badge */}
          {price != null && (
            <View style={styles.priceBadge}>
              <Text style={styles.priceFrom}>from</Text>
              <Text style={styles.priceVal}>{inr(price)}</Text>
              <Text style={styles.priceNight}>/n</Text>
            </View>
          )}
        </View>

        {/* ── Body ─── */}
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>

          <View style={styles.locRow}>
            <MapPin size={11} color={colors.ink400}/>
            <Text style={styles.locText} numberOfLines={1}>
              {lodge.city}{lodge.state ? `, ${lodge.state}` : ""}
            </Text>
          </View>

          {/* Amenities */}
          {(lodge.amenities?.length ?? 0) > 0 && (
            <View style={styles.amenityRow}>
              {(lodge.amenities ?? []).slice(0, 3).map(a => (
                <View key={a} style={styles.amenityChip}>
                  <Text style={styles.amenityText}>{a.trim()}</Text>
                </View>
              ))}
              {(lodge.amenities?.length ?? 0) > 3 && (
                <Text style={styles.amenityMore}>+{(lodge.amenities!.length) - 3}</Text>
              )}
            </View>
          )}

          {/* Availability */}
          {typeof lodge.available_rooms === "number" && lodge.available_rooms > 0 && (
            <View style={styles.availRow}>
              <View style={styles.availDot}/>
              <Text style={styles.availText}>
                {lodge.available_rooms} room{lodge.available_rooms > 1 ? "s" : ""} available
              </Text>
            </View>
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.ink100,
    marginBottom: spacing.md,
    overflow: "hidden",
    ...shadows.card,
  },
  imageWrap: {
    aspectRatio: 16 / 10,
    backgroundColor: colors.navyDark,
    position: "relative",
  },
  image:            { width: "100%", height: "100%" },
  imagePlaceholder: {
    width: "100%", height: "100%",
    justifyContent: "center", alignItems: "center",
    backgroundColor: colors.navy,
  },
  // Three stacked semi-transparent views simulate a CSS linear-gradient overlay
  // Layer 1: very subtle full-image darkening (helps badges readable at top)
  gradLayer1: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7,19,28,0.08)",
  },
  // Layer 2: mid-image fade starting at 35% from bottom
  gradLayer2: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: "50%",
    backgroundColor: "rgba(7,19,28,0.22)",
  },
  // Layer 3: strong darkening at bottom 25% for type pill legibility
  gradLayer3: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: "28%",
    backgroundColor: "rgba(7,19,28,0.38)",
  },
  typePill: {
    position: "absolute", bottom: 10, left: 10,
    backgroundColor: "rgba(7,19,28,0.72)",
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full,
  },
  typePillText: {
    color: colors.white, fontSize: 9, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  ratingBadge: {
    position: "absolute", top: 10, left: 10,
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(7,19,28,0.80)",
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.full,
  },
  ratingText: { color: colors.white, fontSize: 10, fontWeight: "700" },
  heartBtn: {
    position: "absolute", top: 10, right: 10,
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: "rgba(7,19,28,0.55)",
    justifyContent: "center", alignItems: "center",
    ...shadows.soft,
  },
  priceBadge: {
    position: "absolute", bottom: 10, right: 10,
    flexDirection: "row", alignItems: "baseline", gap: 2,
    backgroundColor: "rgba(253,250,243,0.96)",
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.md,
    ...shadows.xs,
  },
  priceFrom:  { fontSize: 9,  color: colors.ink500, fontWeight: "600" },
  priceVal:   { fontSize: 14, color: colors.navy,   fontWeight: "800" },
  priceNight: { fontSize: 9,  color: colors.ink500, fontWeight: "500" },

  // Body
  body:     { padding: spacing.md },
  name:     { fontSize: 16, fontWeight: "700", color: colors.navy, marginBottom: 4, letterSpacing: -0.2 },
  locRow:   { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
  locText:  { fontSize: 12, color: colors.ink500, flex: 1 },
  amenityRow:  { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 8 },
  amenityChip: {
    backgroundColor: colors.ink50, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.ink100,
  },
  amenityText: { fontSize: 10, color: colors.ink600, fontWeight: "600" },
  amenityMore: { fontSize: 10, color: colors.ink400, fontWeight: "500" },
  availRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  availDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.sage },
  availText:{ fontSize: 11, color: colors.sage, fontWeight: "600" },
});
