import React, { useState, useEffect } from "react";
import {
  ScrollView, View, Text, StyleSheet, Pressable, Platform, TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { MapPin, Calendar, Users, Search as SearchIcon,
         ShieldCheck, TrendingUp, Heart, Sparkles, ArrowRight } from "lucide-react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import { rustoPublic, Lodge } from "@/api/rusto";
import { LodgeCard } from "@/components/LodgeCard";
import { Eyebrow } from "@/components/UI";
import { todayISO, addDays } from "@/lib/format";

/**
 * Home — landing screen for the customer app.
 *
 * Layout (top to bottom):
 *   - Navy hero with brand mark + "Travel Anywhere. Rest Everywhere." + search card
 *   - Trust strip (3 quick-trust signals)
 *   - Popular cities (chips, tappable → filter search)
 *   - Featured lodges (first 6 published)
 */
export default function Home() {
  const router = useRouter();
  const [cities, setCities]     = useState<{ city: string }[]>([]);
  const [featured, setFeatured] = useState<Lodge[]>([]);

  const [city, setCity]   = useState("");
  const [from, setFrom]   = useState(todayISO());
  const [to,   setTo]     = useState(addDays(todayISO(), 2));
  const [guests, setGuests] = useState(2);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker,   setShowToPicker]   = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, f] = await Promise.all([
          rustoPublic.cities(),
          rustoPublic.search({}),
        ]);
        setCities(c.data || []);
        setFeatured((f.data.lodges || []).slice(0, 6));
      } catch { /* silent — show empty state */ }
    })();
  }, []);

  const goSearch = () => {
    router.push({
      pathname: "/(tabs)/search",
      params: { city, from, to, guests: String(guests) },
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ink50 }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.huge }}>

        {/* ── Hero ─────────────────────────────────────────────── */}
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Sparkles size={16} color={colors.navyDark}/>
            </View>
            <Text style={styles.brandText}>Rusto</Text>
          </View>
          <Text style={styles.heroHeading}>Travel</Text>
          <Text style={[styles.heroHeading, styles.heroHeadingItalic]}>Anywhere.</Text>
          <Text style={styles.heroSub}>
            Rest <Text style={styles.heroSubGold}>Everywhere.</Text>
          </Text>
          <Text style={styles.heroSubtitle}>
            Discover trusted lodges across India. Real availability. Honest prices.
          </Text>

          {/* Search card overlapping the hero/content seam */}
          <View style={styles.searchCard}>
            <SearchRow icon={<MapPin size={16} color={colors.gold}/>}>
              <PressInput value={city} onChangeText={setCity}
                           placeholder="City or location" autoCorrect={false}/>
            </SearchRow>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <SearchRow icon={<Calendar size={16} color={colors.gold}/>}>
                  <Pressable onPress={() => setShowFromPicker(true)} style={{ flex: 1 }}>
                    <Text style={styles.dateText}>{from || "Check-in"}</Text>
                  </Pressable>
                </SearchRow>
              </View>
              <View style={{ flex: 1 }}>
                <SearchRow icon={<Calendar size={16} color={colors.gold}/>}>
                  <Pressable onPress={() => setShowToPicker(true)} style={{ flex: 1 }}>
                    <Text style={styles.dateText}>{to || "Check-out"}</Text>
                  </Pressable>
                </SearchRow>
              </View>
            </View>
            <SearchRow icon={<Users size={16} color={colors.gold}/>}>
              <Pressable onPress={() => setGuests(g => (g % 8) + 1)} style={{ flex: 1 }}>
                <Text style={styles.dateText}>{guests} guest{guests > 1 ? "s" : ""}</Text>
              </Pressable>
            </SearchRow>
            <Pressable onPress={goSearch} style={({pressed}) => [styles.searchBtn, pressed && { opacity: 0.85 }]}>
              <SearchIcon size={16} color={colors.navyDark}/>
              <Text style={styles.searchBtnText}>Search lodges</Text>
            </Pressable>
          </View>

          {showFromPicker && (
            <DateTimePicker mode="date" value={new Date(from)} minimumDate={new Date()}
                            onChange={(_, d) => {
                              setShowFromPicker(Platform.OS === "ios");
                              if (d) setFrom(d.toISOString().slice(0, 10));
                            }}/>
          )}
          {showToPicker && (
            <DateTimePicker mode="date" value={new Date(to)} minimumDate={new Date(from)}
                            onChange={(_, d) => {
                              setShowToPicker(Platform.OS === "ios");
                              if (d) setTo(d.toISOString().slice(0, 10));
                            }}/>
          )}
        </View>

        {/* ── Trust strip ──────────────────────────────────────── */}
        <View style={styles.trustStrip}>
          {[
            { Icon: ShieldCheck, title: "Verified Hosts", desc: "Approved by our team" },
            { Icon: TrendingUp,  title: "Honest Prices",   desc: "No hidden fees" },
            { Icon: Heart,        title: "Local Stays",     desc: "Trusted Indian lodges" },
          ].map((t, i) => (
            <View key={i} style={styles.trustItem}>
              <View style={styles.trustIconWrap}>
                <t.Icon size={20} color={colors.goldDark}/>
              </View>
              <Text style={styles.trustTitle}>{t.title}</Text>
              <Text style={styles.trustDesc}>{t.desc}</Text>
            </View>
          ))}
        </View>

        {/* ── Popular cities ──────────────────────────────────── */}
        {cities.length > 0 && (
          <View style={styles.section}>
            <Eyebrow>Explore</Eyebrow>
            <Text style={styles.sectionTitle}>Popular destinations</Text>
            <View style={styles.cityRow}>
              {cities.slice(0, 8).map(c => (
                <Pressable key={c.city}
                            onPress={() => router.push({
                              pathname: "/(tabs)/search",
                              params: { city: c.city },
                            })}
                            style={({pressed}) => [styles.cityChip, pressed && { backgroundColor: colors.gold }]}>
                  <MapPin size={12} color={colors.goldDark}/>
                  <Text style={styles.cityChipText}>{c.city}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* ── Featured lodges ─────────────────────────────────── */}
        {featured.length > 0 && (
          <View style={styles.section}>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
              <View>
                <Eyebrow>Stay tonight</Eyebrow>
                <Text style={styles.sectionTitle}>Featured lodges</Text>
              </View>
              <Pressable onPress={() => router.push("/(tabs)/search")}>
                <Text style={styles.seeAll}>See all <ArrowRight size={11} color={colors.goldDark}/></Text>
              </Pressable>
            </View>
            {featured.map(l => <LodgeCard key={l.code} lodge={l}/>)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Sub-component: row inside the search card with leading icon + content slot.
function SearchRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.searchRow}>
      {icon}
      <View style={{ flex: 1, marginLeft: 8 }}>{children}</View>
    </View>
  );
}

function PressInput(props: any) {
  // Wraps TextInput in a fashion that doesn't conflict with date pressables.
  // Just a thin styled wrapper.
  return (
    <TextInput {...props}
                placeholderTextColor={colors.ink400}
                style={styles.textInput}/>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.navyDark,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: 70,        // extra to overlap search card
    position: "relative",
    overflow: "hidden",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.lg },
  brandMark: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: colors.gold,
    justifyContent: "center", alignItems: "center",
    ...shadows.gold,
  },
  brandText: { color: colors.white, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  heroHeading: {
    color: colors.white, fontSize: 44, lineHeight: 50, fontWeight: "700",
    letterSpacing: -1, marginBottom: -2,
  },
  heroHeadingItalic: {
    color: colors.gold, fontStyle: "italic", fontWeight: "700",
  },
  heroSub: {
    color: "rgba(255,255,255,0.85)", fontSize: 22, fontWeight: "500", marginTop: 6,
  },
  heroSubGold: { color: colors.gold, fontStyle: "italic" },
  heroSubtitle: {
    color: "rgba(255,255,255,0.65)", fontSize: 13, lineHeight: 19,
    marginTop: spacing.md, maxWidth: 360,
  },
  searchCard: {
    backgroundColor: colors.white, borderRadius: radius.xl,
    padding: spacing.sm, marginTop: spacing.xl,
    ...shadows.card,
  },
  searchRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.white,
    borderWidth: 1, borderColor: colors.ink200, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    marginBottom: 6,
  },
  textInput: {
    fontSize: 14, color: colors.navy, paddingVertical: 0,
  },
  dateText: { fontSize: 14, color: colors.navy, fontWeight: "500" },
  searchBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: colors.gold, paddingVertical: 13,
    borderRadius: radius.md, marginTop: 6, gap: 8,
    ...shadows.gold,
  },
  searchBtnText: { color: colors.navyDark, fontWeight: "700", fontSize: 15 },

  trustStrip: {
    flexDirection: "row", backgroundColor: colors.white,
    paddingHorizontal: spacing.md, paddingVertical: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.ink100, marginTop: 0,
  },
  trustItem: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  trustIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.goldGlow,
    justifyContent: "center", alignItems: "center", marginBottom: 6,
  },
  trustTitle: { fontSize: 12, fontWeight: "700", color: colors.navy, marginBottom: 2 },
  trustDesc: { fontSize: 10, color: colors.ink500, textAlign: "center" },

  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  sectionTitle: {
    fontSize: 22, fontWeight: "700", color: colors.navy,
    letterSpacing: -0.5, marginBottom: spacing.md, marginTop: 4,
  },
  cityRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cityChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.ink200,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
  },
  cityChipText: { fontSize: 12, color: colors.navy, fontWeight: "600" },
  seeAll: { color: colors.goldDark, fontWeight: "600", fontSize: 12 },
});
