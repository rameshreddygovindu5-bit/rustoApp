import React, { useState, useCallback } from "react";
import {
  ScrollView, View, Text, StyleSheet, Alert,
  RefreshControl, Pressable, Image,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Heart, Trash2 } from "lucide-react-native";
import { colors, radius, spacing, shadows } from "@/theme";
import { useAuth } from "@/context/AuthContext";
import { rustoWishlist, WishlistItem } from "@/api/rusto";
import { Button, EmptyState, Loading } from "@/components/UI";
import { inr, errorMessage } from "@/lib/format";

/**
 * Wishlist screen — shows all saved lodges.
 * Accessed from Account tab > Wishlist button, or directly.
 */
export default function Wishlist() {
  const { customer, loading: authLoading } = useAuth();
  const router = useRouter();
  const [saved,     setSaved]     = useState<WishlistItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);

  const load = useCallback(async () => {
    try {
      const r = await rustoWishlist.list();
      setSaved(r.data.saved || []);
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { if (customer) load(); }, [customer, load]));

  const unsave = async (code: string) => {
    try {
      await rustoWishlist.unsave(code);
      setSaved(s => s.filter(l => l.code !== code));
    } catch (e) { Alert.alert("Failed", errorMessage(e)); }
  };

  if (authLoading) return <Loading message="Loading..."/>;
  if (!customer) return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl }}>
      <EmptyState
        icon={<Heart size={36} color={colors.ink300}/>}
        title="Sign in to see your wishlist"
        description="Save lodges you love and come back to them anytime."
        action={() => router.push("/signin")}
        actionLabel="Sign in"
      />
    </View>
  );

  if (loading) return <Loading message="Loading wishlist..."/>;

  if (saved.length === 0) return (
    <ScrollView
      contentContainerStyle={{ flex: 1, justifyContent: "center", padding: spacing.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}/>}>
      <EmptyState
        icon={<Heart size={36} color={colors.ink300}/>}
        title="Your wishlist is empty"
        description="Browse lodges and tap the heart icon to save them here."
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
      <Text style={styles.heading}>{saved.length} saved lodge{saved.length !== 1 ? "s" : ""}</Text>
      {saved.map(lodge => (
        <WishlistCard
          key={lodge.code}
          lodge={lodge}
          onPress={() => router.push({ pathname: "/lodges/[code]", params: { code: lodge.code } } as any)}
          onUnsave={() => unsave(lodge.code)}
        />
      ))}
    </ScrollView>
  );
}

function WishlistCard({ lodge, onPress, onUnsave }: {
  lodge: WishlistItem;
  onPress: () => void;
  onUnsave: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
      <View style={styles.imageWrap}>
        {lodge.cover_photo ? (
          <Image source={{ uri: lodge.cover_photo }} style={styles.image} resizeMode="cover"/>
        ) : (
          <View style={[styles.image, { backgroundColor: colors.navy, justifyContent: "center", alignItems: "center" }]}>
            <Heart size={32} color="rgba(255,255,255,0.3)"/>
          </View>
        )}
      </View>
      <View style={styles.body}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.name} numberOfLines={1}>{lodge.name}</Text>
            {lodge.city && <Text style={styles.city}>{lodge.city}</Text>}
          </View>
          <Pressable
            onPress={onUnsave}
            hitSlop={8}
            accessibilityLabel="Remove from wishlist">
            <Trash2 size={16} color={colors.ink400}/>
          </Pressable>
        </View>
        {(lodge.starting_tariff ?? lodge.starting_price) != null && (
          <Text style={styles.price}>from {inr(lodge.starting_tariff ?? lodge.starting_price)} / night</Text>
        )}
        <View style={{ marginTop: spacing.sm }}>
          <Button title="View lodge" variant="outline" small onPress={onPress}/>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 20, fontWeight: "700", color: colors.navy, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.white, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.ink100, marginBottom: spacing.md,
    overflow: "hidden", ...shadows.soft,
  },
  imageWrap:{ aspectRatio: 16/9, backgroundColor: colors.navyDark },
  image:    { width: "100%", height: "100%" },
  body:     { padding: spacing.md },
  name:     { fontSize: 16, fontWeight: "700", color: colors.navy },
  city:     { fontSize: 12, color: colors.ink500, marginTop: 2 },
  price:    { fontSize: 13, color: colors.goldDark, fontWeight: "600", marginTop: 4 },
});
