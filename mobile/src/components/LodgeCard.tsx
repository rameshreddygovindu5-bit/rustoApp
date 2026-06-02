import React from "react";
import { Pressable, View, Text, StyleSheet, Image } from "react-native";
import { useRouter } from "expo-router";
import { MapPin, Sparkles } from "lucide-react-native";
import { colors, radius, shadows, spacing } from "@/theme";
import { Lodge } from "@/api/rusto";
import { inr } from "@/lib/format";

/**
 * Lodge card — used on Home + Search lists. Image at top, body below.
 *
 * Tapping navigates to the detail screen, preserving any from/to/rooms
 * query so the date picker on the detail page starts pre-filled.
 */
interface Props {
  lodge: Lodge;
  query?: { from?: string; to?: string; rooms?: number; guests?: number };
}

export function LodgeCard({ lodge, query }: Props) {
  const router = useRouter();
  const onPress = () => {
    const params: Record<string, string> = {};
    if (query?.from)   params.from = query.from;
    if (query?.to)     params.to = query.to;
    if (query?.rooms)  params.rooms = String(query.rooms);
    if (query?.guests) params.guests = String(query.guests);
    router.push({ pathname: "/lodges/[code]", params: { code: lodge.code, ...params } });
  };

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [
      styles.card, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
    ]}>
      {/* Image */}
      <View style={styles.imageWrap}>
        {lodge.cover_photo ? (
          <Image source={{ uri: lodge.cover_photo }}
                 style={styles.image} resizeMode="cover"/>
        ) : (
          <View style={styles.imagePlaceholder}>
            <Sparkles size={40} color="rgba(255,255,255,0.3)"/>
          </View>
        )}
        {lodge.starting_price != null && (
          <View style={styles.priceBadge}>
            <Text style={styles.priceFrom}>from</Text>
            <Text style={styles.priceVal}>{inr(lodge.starting_price)}</Text>
          </View>
        )}
        {typeof lodge.available_rooms === "number" && (
          <View style={styles.availBadge}>
            <Text style={styles.availText}>{lodge.available_rooms} avail</Text>
          </View>
        )}
      </View>

      {/* Body */}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{lodge.name}</Text>
        <View style={styles.locRow}>
          <MapPin size={11} color={colors.ink500}/>
          <Text style={styles.locText} numberOfLines={1}>
            {lodge.city}{lodge.state ? `, ${lodge.state}` : ""}
          </Text>
        </View>
        {lodge.description ? (
          <Text style={styles.desc} numberOfLines={2}>{lodge.description}</Text>
        ) : null}
        {lodge.amenities?.length > 0 && (
          <View style={styles.amenityRow}>
            {lodge.amenities.slice(0, 3).map(a => (
              <View key={a} style={styles.amenityChip}>
                <Text style={styles.amenityText}>{a.trim()}</Text>
              </View>
            ))}
            {lodge.amenities.length > 3 && (
              <Text style={styles.amenityMore}>+{lodge.amenities.length - 3}</Text>
            )}
          </View>
        )}
        {lodge.price_for_stay && lodge.nights ? (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total {lodge.nights}n</Text>
            <Text style={styles.totalAmount}>{inr(lodge.price_for_stay)}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.ink100,
    marginBottom: spacing.md,
    overflow: "hidden",
    ...shadows.soft,
  },
  imageWrap: { aspectRatio: 16 / 11, backgroundColor: colors.navyDark, position: "relative" },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: {
    width: "100%", height: "100%",
    justifyContent: "center", alignItems: "center",
    backgroundColor: colors.navy,
  },
  priceBadge: {
    position: "absolute", top: 10, right: 10,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    flexDirection: "row", alignItems: "baseline",
    ...shadows.soft,
  },
  priceFrom: { fontSize: 10, color: colors.ink500, fontWeight: "600", marginRight: 4 },
  priceVal:  { fontSize: 13, fontWeight: "700", color: colors.navy },
  availBadge: {
    position: "absolute", bottom: 10, left: 10,
    backgroundColor: "rgba(34, 197, 94, 0.95)",
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
  },
  availText: { color: colors.white, fontSize: 10, fontWeight: "700",
                textTransform: "uppercase", letterSpacing: 0.5 },
  body: { padding: spacing.md },
  name: { fontSize: 16, fontWeight: "700", color: colors.navy, marginBottom: 2 },
  locRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  locText: { fontSize: 12, color: colors.ink500, flex: 1 },
  desc: { fontSize: 12, color: colors.ink600, lineHeight: 17, marginBottom: 8 },
  amenityRow: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  amenityChip: { backgroundColor: colors.ink50, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  amenityText: { fontSize: 10, color: colors.ink600, fontWeight: "500" },
  amenityMore: { fontSize: 10, color: colors.ink400 },
  totalRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.ink100,
  },
  totalLabel: { fontSize: 10, color: colors.ink500 },
  totalAmount: { fontSize: 14, fontWeight: "700", color: colors.goldDark },
});
