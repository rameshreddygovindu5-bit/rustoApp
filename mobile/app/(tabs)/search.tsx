import React, { useState, useEffect, useCallback } from "react";
import {
  ScrollView, View, Text, StyleSheet, TextInput,
  RefreshControl, Pressable, ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Search as SearchIcon } from "lucide-react-native";
import { colors, radius, spacing } from "@/theme";
import { LodgeCard } from "@/components/LodgeCard";
import { Button, Eyebrow, Loading } from "@/components/UI";
import { rustoPublic, Lodge } from "@/api/rusto";

/**
 * Search results. URL params (city/from/to/rooms/guests) drive the query,
 * matching how the web does it — useful for deep links from the homepage
 * search card or popular-city chips.
 */
export default function Search() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const initialCity = (params.city as string) || "";

  const [cityInput, setCityInput] = useState(initialCity);
  const [results, setResults] = useState<Lodge[]>([]);
  const [count, setCount]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const q: any = {};
      if (cityInput.trim()) q.city = cityInput.trim();
      if (params.from)   q.from = params.from;
      if (params.to)     q.to = params.to;
      if (params.rooms)  q.rooms = +(params.rooms as string);
      if (params.guests) q.guests = +(params.guests as string);
      const r = await rustoPublic.search(q);
      setResults(r.data.lodges || []);
      setCount(r.data.count || 0);
    } catch {
      setResults([]); setCount(0);
    } finally { setLoading(false); setRefreshing(false); }
  }, [cityInput, params.from, params.to, params.rooms, params.guests]);

  // Re-run when the URL params (from Home → Search nav) change.
  useEffect(() => { search(); }, [params.city, params.from, params.to, params.rooms, params.guests]);
  // When initial mount has city from URL, ensure it's reflected in the input.
  useEffect(() => { if (initialCity) setCityInput(initialCity); }, [initialCity]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink50 }}>
      {/* Sticky search bar */}
      <View style={styles.searchBar}>
        <SearchIcon size={16} color={colors.gold}/>
        <TextInput value={cityInput}
                    onChangeText={setCityInput}
                    onSubmitEditing={search}
                    placeholder="City or location"
                    placeholderTextColor={colors.ink400}
                    style={styles.searchInput}
                    returnKeyType="search"/>
        <Pressable onPress={search}
                    style={({pressed}) => [styles.searchBtn, pressed && { opacity: 0.85 }]}>
          <Text style={styles.searchBtnText}>Go</Text>
        </Pressable>
      </View>

      {loading ? (
        <Loading message="Searching…"/>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.huge }}
          refreshControl={<RefreshControl refreshing={refreshing}
                                            onRefresh={() => { setRefreshing(true); search(); }}/>}>
          <View style={{ marginBottom: spacing.md }}>
            <Eyebrow>Lodges</Eyebrow>
            <Text style={styles.heading}>
              {count > 0 ? `${count} found` : "No matches"}
              {cityInput && count > 0 && (
                <Text style={styles.subHeading}>  in {cityInput}</Text>
              )}
            </Text>
          </View>

          {results.length === 0 ? (
            <View style={styles.empty}>
              <SearchIcon size={36} color={colors.ink300}/>
              <Text style={styles.emptyTitle}>No lodges found</Text>
              <Text style={styles.emptyDesc}>
                Try a different city or clear filters.
              </Text>
              <View style={{ marginTop: 16 }}>
                <Button title="Clear filters" variant="outline"
                         onPress={() => { setCityInput(""); router.setParams({ city: "" } as any); }}/>
              </View>
            </View>
          ) : (
            results.map(l => (
              <LodgeCard key={l.code} lodge={l}
                          query={{
                            from:   params.from as string,
                            to:     params.to as string,
                            rooms:  params.rooms ? +(params.rooms as string) : undefined,
                            guests: params.guests ? +(params.guests as string) : undefined,
                          }}/>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.ink100,
    gap: 8,
  },
  searchInput: {
    flex: 1, fontSize: 15, color: colors.navy,
    borderWidth: 1, borderColor: colors.ink200,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.md,
  },
  searchBtn: {
    backgroundColor: colors.gold,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderRadius: radius.md,
  },
  searchBtnText: { color: colors.navyDark, fontWeight: "700", fontSize: 13 },

  heading: { fontSize: 22, fontWeight: "700", color: colors.navy, marginTop: 4 },
  subHeading: { fontSize: 16, fontWeight: "400", color: colors.ink500 },

  empty: {
    backgroundColor: colors.white, borderRadius: radius.lg,
    padding: spacing.huge, alignItems: "center",
    borderWidth: 1, borderColor: colors.ink100,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.navy, marginTop: 12 },
  emptyDesc: { fontSize: 13, color: colors.ink500, marginTop: 4, textAlign: "center" },
});
