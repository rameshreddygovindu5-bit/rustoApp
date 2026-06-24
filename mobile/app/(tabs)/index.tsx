/**
 * Home screen v2 — "Indian Dusk" design with animations.
 *
 * Animated elements:
 *  • Hero heading: staggered fade+rise (title → tagline → subtitle)
 *  • Search card:  slides up 200ms after hero text settles
 *  • Trust strip:  fade in from left
 *  • City chips:   staggered scale-in (cascade via delay)
 *  • Lodge cards:  AnimatedCard (from UI.tsx) with per-card delays
 *  • Floating orbs: gentle drift animation behind hero
 *
 * Feature parity with web RustoHome.jsx:
 *  ✅ Location / date / guests search
 *  ✅ Popular cities
 *  ✅ Featured lodges with skeleton loading
 *  ✅ Trust strip (Verified / Honest / Local)
 *  ✅ Pull-to-refresh
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Animated, Easing, ScrollView, View, Text, StyleSheet,
  Pressable, TextInput, RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  MapPin, Users, Search as SearchIcon,
  ShieldCheck, TrendingUp, Heart, Sparkles,
} from "lucide-react-native";
import { colors, radius, shadows, spacing, timing } from "@/theme";
import { rustoPublic, rustoWishlist, Lodge } from "@/api/rusto";
import { LodgeCard } from "@/components/LodgeCard";
import {
  Eyebrow, LodgeSkeleton, DatePickerField,
  AnimatedCard, ShimmerView,
} from "@/components/UI";
import { todayISO, addDays } from "@/lib/format";

// ── Floating orb component ────────────────────────────────────────────────────
function FloatingOrb({ x, y, size, delay }: {
  x: number; y: number; size: number; delay: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1, duration: 5000 + delay * 800,
          easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0, duration: 5000 + delay * 800,
          easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
      ])
    );
    const t = setTimeout(() => loop.start(), delay * 400);
    return () => { clearTimeout(t); loop.stop(); };
  }, [delay, anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });
  const opacity    = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.12, 0.22, 0.12] });

  return (
    <Animated.View
      style={{
        position: "absolute", left: x, top: y,
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: colors.gold,
        transform: [{ translateY }],
        opacity,
        pointerEvents: "none",
      }}
    />
  );
}

// Property type chips — synced with web RustoHome TYPES
const PROP_TYPES = [
  { key: "",               label: "All" },
  { key: "heritage_hotel", label: "Heritage" },
  { key: "resort",         label: "Resorts" },
  { key: "villa",          label: "Villas" },
  { key: "homestay",       label: "Homestays" },
  { key: "boutique_hotel", label: "Boutique" },
  { key: "lodge",          label: "Lodges" },
];

// ── Search row ────────────────────────────────────────────────────────────────
function SearchRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.searchRow}>
      {icon}
      <View style={{ flex: 1, marginLeft: 8 }}>{children}</View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function Home() {
  const router    = useRouter();
  const { customer } = useAuth();
  const [cities,    setCities]    = useState<string[]>([]);
  const [featured,  setFeatured]  = useState<Lodge[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [networkError,setNetworkError] = useState<string | null>(null);
  const [savedCodes,  setSavedCodes]   = useState<Set<string>>(new Set());
  const [refreshing,  setRefreshing]   = useState(false);

  const [city,     setCity]     = useState("");
  const [from,     setFrom]     = useState(todayISO());
  const [to,       setTo]       = useState(addDays(todayISO(), 2));
  const [guests,   setGuests]   = useState(2);
  const [propType, setPropType] = useState("");  // property type filter chip

  // Animation refs
  const heroTitle1  = useRef(new Animated.Value(0)).current;
  const heroTitle2  = useRef(new Animated.Value(0)).current;
  const heroSub     = useRef(new Animated.Value(0)).current;
  const searchSlide = useRef(new Animated.Value(32)).current;
  const searchOpacity = useRef(new Animated.Value(0)).current;
  const trustOpacity  = useRef(new Animated.Value(0)).current;

  // Run entrance animations on mount
  useEffect(() => {
    const seq = Animated.stagger(120, [
      Animated.timing(heroTitle1, {
        toValue: 1, duration: timing.slow,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(heroTitle2, {
        toValue: 1, duration: timing.slow,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(heroSub, {
        toValue: 1, duration: timing.slow,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]);

    const searchAnim = Animated.parallel([
      Animated.timing(searchSlide, {
        toValue: 0, duration: timing.slow, delay: 460,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(searchOpacity, {
        toValue: 1, duration: timing.slow, delay: 460,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
    ]);

    const trustAnim = Animated.timing(trustOpacity, {
      toValue: 1, duration: timing.slow, delay: 700,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    });

    seq.start();
    searchAnim.start();
    trustAnim.start();
  }, []);

  const load = useCallback(async () => {
    setNetworkError(null);
    try {
      const searchParams: any = { limit: 6 };
      if (propType) searchParams.property_type = propType;
      const [c, f] = await Promise.all([
        rustoPublic.cities(),
        rustoPublic.search(searchParams),
      ]);
      setCities(Array.isArray(c.data) ? c.data as string[] : []);
      setFeatured(f.data.lodges ?? []);
    } catch (e: any) {
      const msg = e?.readableMessage || e?.message || null;
      if (msg) setNetworkError(msg);
    }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Reload featured when property type filter changes
  useEffect(() => { load(); }, [propType]);

  // Load wishlist for logged-in users
  useEffect(() => {
    if (!customer) return;
    rustoWishlist.list()
      .then(r => setSavedCodes(new Set((r.data.saved || []).map((w: any) => w.code))))
      .catch(() => {});
  }, [customer]);

  const handleSave = useCallback(async (code: string) => {
    if (!customer) { router.push("/signin" as any); return; }
    const wasSaved = savedCodes.has(code);
    setSavedCodes(prev => { const next = new Set(prev); wasSaved ? next.delete(code) : next.add(code); return next; });
    try {
      if (wasSaved) await rustoWishlist.unsave(code);
      else          await rustoWishlist.save(code);
    } catch {
      setSavedCodes(prev => { const next = new Set(prev); wasSaved ? next.add(code) : next.delete(code); return next; });
    }
  }, [customer, savedCodes, router]);

  const goSearch = useCallback(() => {
    const params: any = { city, from, to, guests: String(guests) };
    if (propType) params.property_type = propType;
    router.push({ pathname: "/(tabs)/search", params } as any);
  }, [city, from, to, guests, propType, router]);

  const mkOpacityTranslate = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [{
      translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }),
    }],
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.navyDark }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.huge, backgroundColor: colors.ink50 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.gold}
          />
        }
        showsVerticalScrollIndicator={false}>

        {/* ── Hero ────────────────────────────────────────────────── */}
        <View style={styles.hero}>
          {/* Floating orbs (ambient atmosphere) */}
          <FloatingOrb x={-30}  y={10}  size={120} delay={0}/>
          <FloatingOrb x={260}  y={-20} size={90}  delay={1}/>
          <FloatingOrb x={140}  y={100} size={60}  delay={2}/>
          <FloatingOrb x={30}   y={160} size={40}  delay={3}/>

          {/* Brand mark */}
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Sparkles size={14} color={colors.navyDark}/>
            </View>
            <Text style={styles.brandText}>Rusto</Text>
            <View style={styles.brandTagline}>
              <Text style={styles.brandTaglineText}>INDIA</Text>
            </View>
          </View>

          {/* Headline */}
          <Animated.Text style={[styles.heroH1, mkOpacityTranslate(heroTitle1)]}>
            Travel
          </Animated.Text>
          <Animated.Text style={[styles.heroH1, styles.heroH1Gold, mkOpacityTranslate(heroTitle2)]}>
            Anywhere.
          </Animated.Text>
          <Animated.Text style={[styles.heroSub, mkOpacityTranslate(heroSub)]}>
            Rest{" "}
            <Text style={styles.heroSubAccent}>Everywhere.</Text>
          </Animated.Text>
          <Animated.Text style={[styles.heroBody, mkOpacityTranslate(heroSub)]}>
            Discover verified lodges across India.{"\n"}Real availability. Honest prices.
          </Animated.Text>

          {/* Search card */}
          <Animated.View style={[
            styles.searchCard,
            { opacity: searchOpacity, transform: [{ translateY: searchSlide }] },
          ]}>
            <SearchRow icon={<MapPin size={15} color={colors.gold}/>}>
              <TextInput
                value={city}
                onChangeText={setCity}
                onSubmitEditing={goSearch}
                returnKeyType="search"
                placeholder="City or destination"
                placeholderTextColor={colors.ink400}
                style={styles.textInput}
                autoCorrect={false}
                autoCapitalize="words"
              />
            </SearchRow>

            <View style={{ flexDirection: "row", gap: 6 }}>
              <View style={{ flex: 1 }}>
                <DatePickerField
                  label="Check-in"
                  value={from}
                  onChange={setFrom}
                  minimumDate={new Date()}
                />
              </View>
              <View style={{ flex: 1 }}>
                <DatePickerField
                  label="Check-out"
                  value={to}
                  onChange={setTo}
                  minimumDate={from ? new Date(from) : new Date()}
                />
              </View>
            </View>

            <SearchRow icon={<Users size={15} color={colors.gold}/>}>
              <Pressable
                onPress={() => setGuests(g => (g % 8) + 1)}
                style={{ flex: 1 }}
                accessibilityLabel={guests + " guests, tap to change"}>
                <Text style={styles.guestsText}>
                  {guests} guest{guests > 1 ? "s" : ""}
                </Text>
              </Pressable>
            </SearchRow>

            <Pressable
              onPress={goSearch}
              style={({ pressed }) => [styles.searchBtn, pressed && { opacity: 0.88 }]}
              accessibilityRole="button"
              accessibilityLabel="Search lodges">
              <SearchIcon size={15} color={colors.navyDark}/>
              <Text style={styles.searchBtnText}>Search lodges</Text>
            </Pressable>
          </Animated.View>
        </View>

        {/* ── Trust strip ────────────────────────────────────────── */}
        <Animated.View style={[styles.trustStrip, { opacity: trustOpacity }]}>
          {[
            { Icon: ShieldCheck, title: "Verified Hosts",  desc: "Approved by our team" },
            { Icon: TrendingUp,  title: "Honest Prices",   desc: "No hidden charges" },
            { Icon: Heart,       title: "Local Stays",     desc: "Trusted Indian lodges" },
          ].map((t, i) => (
            <View key={i} style={styles.trustItem}>
              <View style={styles.trustIconWrap}>
                <t.Icon size={18} color={colors.goldDark}/>
              </View>
              <Text style={styles.trustTitle}>{t.title}</Text>
              <Text style={styles.trustDesc}>{t.desc}</Text>
            </View>
          ))}
        </Animated.View>

        {/* ── Popular cities ──────────────────────────────────────── */}
        {cities.length > 0 && (
          <AnimatedCard delay={200} style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl }}>
            <Eyebrow>Explore India</Eyebrow>
            <Text style={styles.sectionTitle}>Popular destinations</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}>
              {cities.slice(0, 10).map((cityStr, i) => (
                <AnimatedCard key={cityStr} delay={220 + i * 40}>
                  <Pressable
                    onPress={() => router.push({
                      pathname: "/(tabs)/search",
                      params: { city: cityStr },
                    } as any)}
                    style={({ pressed }) => [
                      styles.cityChip,
                      pressed && { backgroundColor: colors.goldGlow, borderColor: colors.goldLight },
                    ]}
                    accessibilityLabel={"Search lodges in " + cityStr}>
                    <MapPin size={11} color={colors.goldDark}/>
                    <Text style={styles.cityChipText}>{cityStr}</Text>
                  </Pressable>
                </AnimatedCard>
              ))}
            </ScrollView>
          </AnimatedCard>
        )}

        {/* ── Property type filter chips — synced with web ────────── */}
        <AnimatedCard delay={260} style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}>
            {PROP_TYPES.map(pt => (
              <Pressable
                key={pt.key}
                onPress={() => {
                  setPropType(prev => prev === pt.key ? "" : pt.key);
                }}
                style={[
                  styles.propChip,
                  propType === pt.key && styles.propChipActive,
                ]}
                accessibilityLabel={`Filter by ${pt.label}`}>
                <Text style={[
                  styles.propChipText,
                  propType === pt.key && styles.propChipTextActive,
                ]}>
                  {pt.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </AnimatedCard>

        {/* ── Featured lodges ─────────────────────────────────────── */}
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl }}>
          <AnimatedCard delay={300}>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: spacing.sm }}>
              <View>
                <Eyebrow>Stay tonight</Eyebrow>
                <Text style={styles.sectionTitle}>Featured lodges</Text>
              </View>
              <Pressable onPress={() => router.push("/(tabs)/search" as any)}>
                <Text style={styles.seeAll}>See all →</Text>
              </Pressable>
            </View>
          </AnimatedCard>

          {loading ? (
            <>
              <LodgeSkeleton/>
              <LodgeSkeleton/>
              <LodgeSkeleton/>
            </>
          ) : networkError ? (
            <AnimatedCard delay={400} style={[styles.emptyFeatured, { backgroundColor: colors.warningBg, borderRadius: radius.lg }]}>
              <Sparkles size={24} color={colors.goldDark}/>
              <Text style={[styles.emptyText, { color: "#92400E", fontWeight: "700", textAlign: "center" }]}>
                Cannot connect to server
              </Text>
              <Text style={{ fontSize: 11, color: "#92400E", textAlign: "center", lineHeight: 16, marginTop: 4 }}>
                {networkError.includes("localhost") || networkError.includes("127.0.0.1")
                  ? "Set EXPO_PUBLIC_API_URL to your computer's LAN IP (e.g. http://192.168.x.x:8000)"
                  : networkError}
              </Text>
            </AnimatedCard>
          ) : featured.length === 0 ? (
            <AnimatedCard delay={400} style={styles.emptyFeatured}>
              <Sparkles size={30} color={colors.ink300}/>
              <Text style={styles.emptyText}>No featured lodges yet</Text>
            </AnimatedCard>
          ) : (
            featured.map((l, i) => (
              <AnimatedCard key={l.code} delay={350 + i * 60}>
                <LodgeCard lodge={l} saved={savedCodes.has(l.code)} onSave={handleSave}/>
              </AnimatedCard>
            ))
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Hero
  hero: {
    backgroundColor: colors.navyDark,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: 80,
    overflow: "hidden",
  },
  brandRow:        { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.xl },
  brandMark:       {
    width: 32, height: 32, borderRadius: radius.md,
    backgroundColor: colors.gold, justifyContent: "center", alignItems: "center",
    ...shadows.gold,
  },
  brandText:       { color: colors.white, fontSize: 18, fontWeight: "800", letterSpacing: -0.4 },
  brandTagline:    {
    backgroundColor: "rgba(232,160,32,0.18)",
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.xs,
    marginLeft: 2,
  },
  brandTaglineText:{ color: colors.goldLight, fontSize: 8, fontWeight: "800", letterSpacing: 2 },

  heroH1:      {
    color: colors.white, fontSize: 48, lineHeight: 54,
    fontWeight: "800", letterSpacing: -1.2, marginBottom: -4,
  },
  heroH1Gold:  { color: colors.goldLight, fontStyle: "italic" },
  heroSub:     {
    color: "rgba(255,255,255,0.90)", fontSize: 20,
    fontWeight: "500", marginTop: 10,
  },
  heroSubAccent: { color: colors.gold, fontStyle: "italic" },
  heroBody:    {
    color: "rgba(255,255,255,0.58)", fontSize: 13,
    lineHeight: 20, marginTop: spacing.sm, marginBottom: 4,
  },

  // Search card
  searchCard: {
    backgroundColor: colors.white,
    borderRadius: radius.xxl,
    padding: spacing.sm,
    marginTop: spacing.xl,
    gap: 6,
    ...shadows.lifted,
  },
  searchRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.ink50,
    borderWidth: 1.5, borderColor: colors.ink200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 11,
  },
  textInput:   { fontSize: 14, color: colors.navy, paddingVertical: 0, flex: 1, fontWeight: "500" },
  guestsText:  { fontSize: 14, color: colors.navy, fontWeight: "600" },
  searchBtn:   {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: colors.gold,
    paddingVertical: 14, borderRadius: radius.lg, gap: 8,
    ...shadows.gold,
  },
  searchBtnText: { color: colors.navyDark, fontWeight: "800", fontSize: 15, letterSpacing: 0.1 },

  // Trust strip
  trustStrip: {
    flexDirection: "row", backgroundColor: colors.white,
    paddingHorizontal: spacing.md, paddingVertical: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.ink100,
    gap: 4,
  },
  trustItem:    { flex: 1, alignItems: "center", paddingHorizontal: 2 },
  trustIconWrap:{
    width: 38, height: 38, borderRadius: radius.lg,
    backgroundColor: colors.goldGlow,
    justifyContent: "center", alignItems: "center",
    marginBottom: 6, ...shadows.xs,
  },
  trustTitle:   { fontSize: 11, fontWeight: "700", color: colors.navy, marginBottom: 2, textAlign: "center" },
  trustDesc:    { fontSize: 9,  color: colors.ink500, textAlign: "center", lineHeight: 13 },

  // Section
  sectionTitle: {
    fontSize: 22, fontWeight: "800", color: colors.navy,
    letterSpacing: -0.6, marginBottom: spacing.md, marginTop: 3,
  },

  // Cities
  cityChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: colors.white,
    borderWidth: 1.5, borderColor: colors.ink200,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full,
    ...shadows.xs,
  },
  cityChipText: { fontSize: 12, color: colors.navy, fontWeight: "700" },
  seeAll:       { color: colors.goldDark, fontWeight: "700", fontSize: 12 },

  // Empty
  emptyFeatured: { alignItems: "center", paddingVertical: spacing.huge, gap: spacing.md },
  emptyText:     { color: colors.ink400, fontSize: 14 },

  // Property type chips
  propChip: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.white,
    borderWidth: 1.5, borderColor: colors.ink200,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: radius.full,
    ...shadows.xs,
  },
  propChipActive: {
    backgroundColor: colors.navyDark,
    borderColor: colors.navyDark,
  },
  propChipText:       { fontSize: 12, color: colors.navy,  fontWeight: "700" },
  propChipTextActive: { fontSize: 12, color: colors.white, fontWeight: "700" },
});
