import React, { useState, useCallback } from "react";
import { ScrollView, View, Text, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Star, Gift, TrendingUp, Award } from "lucide-react-native";
import { colors, radius, spacing, shadows } from "@/theme";
import { useAuth } from "@/context/AuthContext";
import { rustoMembership, MembershipInfo } from "@/api/rusto";
import { Card, EmptyState, Loading, Eyebrow } from "@/components/UI";

const TIER_CONFIG: Record<string, { color: "ink" | "gold" | "navy" | "green" | "amber" | "red"; label: string; emoji: string }> = {
  explorer: { color: "ink",   label: "Explorer", emoji: "🧭" },
  silver:   { color: "ink",   label: "Silver",   emoji: "🥈" },
  gold:     { color: "gold",  label: "Gold",     emoji: "🥇" },
  elite:    { color: "navy",  label: "Elite",    emoji: "👑" },
};

export default function Membership() {
  const { customer, loading: authLoading } = useAuth();
  const router = useRouter();
  const [info,      setInfo]      = useState<MembershipInfo | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);

  const load = useCallback(async () => {
    try {
      const r = await rustoMembership.get();
      setInfo(r.data);
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { if (customer) load(); }, [customer, load]));

  if (authLoading) return <Loading message="Loading..."/>;
  if (!customer) return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl }}>
      <EmptyState
        icon={<Award size={36} color={colors.ink300}/>}
        title="Sign in to view membership"
        description="Earn Rusto Points every time you stay and unlock exclusive perks."
        action={() => router.push("/signin")}
        actionLabel="Sign in"
      />
    </View>
  );

  if (loading) return <Loading message="Loading membership..."/>;
  if (!info)   return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl }}>
      <Text style={{ color: colors.ink500 }}>Could not load membership details.</Text>
    </View>
  );

  const tier   = TIER_CONFIG[info.tier] ?? TIER_CONFIG.explorer;
  const pct    = info.points_to_next
    ? Math.min(100, (info.rusto_points / (info.rusto_points + (info.points_to_next ?? 1))) * 100)
    : 100;

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

      {/* Tier card */}
      <View style={styles.tierCard}>
        <View style={styles.tierTop}>
          <Text style={styles.tierEmoji}>{tier.emoji}</Text>
          <View>
            <Eyebrow color="rgba(255,255,255,0.7)">Rusto Membership</Eyebrow>
            <Text style={styles.tierName}>{tier.label} Member</Text>
            <Text style={styles.memberName}>{customer.full_name}</Text>
          </View>
        </View>
        <View style={styles.pointsRow}>
          <View>
            <Text style={styles.pointsNum}>{info.rusto_points.toLocaleString("en-IN")}</Text>
            <Text style={styles.pointsLabel}>Rusto Points</Text>
          </View>
          <View style={styles.refRow}>
            <Text style={styles.refLabel}>Your referral code</Text>
            <Text style={styles.refCode}>{info.referral_code}</Text>
          </View>
        </View>

        {/* Progress to next tier */}
        {info.next_tier && info.points_to_next && info.points_to_next > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, marginBottom: 4 }}>
              {info.points_to_next.toLocaleString()} points to {info.next_tier}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressBar, { width: `${Math.round(pct)}%` as any }]}/>
            </View>
          </View>
        )}
      </View>

      {/* Perks section */}
      <View style={{ marginTop: spacing.xl }}>
        <Eyebrow>Your benefits</Eyebrow>
        <Text style={styles.sectionTitle}>{tier.label} Perks</Text>
        <View style={styles.perksGrid}>
          {PERKS[info.tier]?.map((p, i) => (
            <View key={i} style={styles.perkItem}>
              <p.Icon size={20} color={colors.goldDark}/>
              <Text style={styles.perkTitle}>{p.title}</Text>
              <Text style={styles.perkDesc}>{p.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* How to earn */}
      <Card style={{ marginTop: spacing.xl }}>
        <Text style={styles.sectionTitle}>How to earn points</Text>
        <View style={{ gap: spacing.md }}>
          {HOW_TO_EARN.map((item, i) => (
            <View key={i} style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
              <View style={styles.earnIcon}>
                <item.Icon size={16} color={colors.goldDark}/>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", fontSize: 14, color: colors.navy }}>{item.title}</Text>
                <Text style={{ fontSize: 12, color: colors.ink500, marginTop: 2 }}>{item.desc}</Text>
              </View>
              <Text style={{ fontWeight: "700", color: colors.goldDark, fontSize: 14 }}>{item.points}</Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Referral */}
      <Card style={{ marginTop: spacing.lg }}>
        <Text style={styles.sectionTitle}>Refer a friend</Text>
        <Text style={{ fontSize: 13, color: colors.ink600, lineHeight: 20 }}>
          Share your referral code <Text style={{ fontWeight: "700", color: colors.navy }}>{info.referral_code}</Text>
          {" "}and earn 50 bonus points when they make their first booking.
        </Text>
      </Card>
    </ScrollView>
  );
}

const PERKS: Record<string, { Icon: any; title: string; desc: string }[]> = {
  explorer: [
    { Icon: TrendingUp, title: "Earn 1× points", desc: "1 point per ₹100 spent" },
    { Icon: Gift,       title: "Welcome bonus",  desc: "100 points on first booking" },
  ],
  silver: [
    { Icon: TrendingUp, title: "Earn 1.5× points", desc: "1.5 points per ₹100 spent" },
    { Icon: Star,       title: "Early access",     desc: "Book 2 days before public" },
  ],
  gold: [
    { Icon: TrendingUp, title: "Earn 2× points",   desc: "2 points per ₹100 spent" },
    { Icon: Star,       title: "Free upgrade",     desc: "One free room upgrade per year" },
    { Icon: Gift,       title: "Birthday bonus",   desc: "200 bonus points on birthday" },
  ],
  elite: [
    { Icon: TrendingUp, title: "Earn 3× points",    desc: "3 points per ₹100 spent" },
    { Icon: Star,       title: "Concierge service", desc: "Priority customer support" },
    { Icon: Gift,       title: "Exclusive rates",   desc: "Up to 15% off all bookings" },
    { Icon: Award,      title: "Late checkout",     desc: "Extended checkout up to 2 PM" },
  ],
};

const HOW_TO_EARN = [
  { Icon: Star,      title: "Complete a stay",     desc: "Points added after checkout", points: "10 pts / ₹100" },
  { Icon: Gift,      title: "Refer a friend",      desc: "When they book their first stay", points: "+50 pts" },
  { Icon: TrendingUp,title: "Write a review",      desc: "After a verified stay", points: "+20 pts" },
];

const styles = StyleSheet.create({
  tierCard: {
    backgroundColor: colors.navyDark, borderRadius: radius.xl,
    padding: spacing.xl, ...shadows.card,
  },
  tierTop:    { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginBottom: spacing.xl },
  tierEmoji:  { fontSize: 48 },
  tierName:   { fontSize: 22, fontWeight: "700", color: colors.white, letterSpacing: -0.5 },
  memberName: { fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 2 },
  pointsRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  pointsNum:  { fontSize: 36, fontWeight: "700", color: colors.gold, letterSpacing: -1 },
  pointsLabel:{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2 },
  refRow:     { alignItems: "flex-end" },
  refLabel:   { fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 4 },
  refCode:    { fontSize: 16, fontWeight: "700", color: colors.gold, letterSpacing: 1.5 },
  progressTrack: {
    height: 4, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 2,
  },
  progressBar: {
    height: 4, backgroundColor: colors.gold, borderRadius: 2,
  },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.navy, marginBottom: spacing.md, marginTop: 4 },
  perksGrid:  { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.sm },
  perkItem:   {
    width: "47%", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.ink100,
    borderRadius: radius.lg, padding: spacing.md, gap: 6, ...shadows.soft,
  },
  perkTitle:  { fontSize: 13, fontWeight: "700", color: colors.navy },
  perkDesc:   { fontSize: 11, color: colors.ink500, lineHeight: 16 },
  earnIcon:   {
    width: 36, height: 36, borderRadius: 10, backgroundColor: colors.goldGlow,
    justifyContent: "center", alignItems: "center",
  },
});
