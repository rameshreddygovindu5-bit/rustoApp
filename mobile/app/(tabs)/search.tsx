import React, { useState, useEffect, useCallback } from "react";
import {
  ScrollView, View, Text, StyleSheet, TextInput,
  RefreshControl, Pressable, Modal, TouchableOpacity,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Search as SearchIcon, SlidersHorizontal, X, ChevronDown } from "lucide-react-native";
import { colors, radius, spacing, shadows } from "@/theme";
import { LodgeCard } from "@/components/LodgeCard";
import { Button, Eyebrow, Loading } from "@/components/UI";
import { useAuth } from "@/context/AuthContext";
import { rustoPublic, rustoWishlist, Lodge } from "@/api/rusto";

// Synced with web RustoSearch SORT_OPTIONS and PROPERTY_TYPES
const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "price-low",   label: "Price: Low to High" },
  { value: "price-high",  label: "Price: High to Low" },
  { value: "rating",      label: "Top Rated" },
];

const PROPERTY_TYPES = [
  { value: "",               label: "All types" },
  { value: "lodge",          label: "Lodge" },
  { value: "hotel",          label: "Hotel" },
  { value: "resort",         label: "Resort" },
  { value: "boutique_hotel", label: "Boutique Hotel" },
  { value: "homestay",       label: "Homestay" },
  { value: "villa",          label: "Villa" },
  { value: "eco_resort",     label: "Eco Resort" },
];

const PRICE_PRESETS = [
  { label: "Any",          min: 0,    max: 0 },
  { label: "Under ₹1,500", min: 0,    max: 1500 },
  { label: "₹1,500–3,000", min: 1500, max: 3000 },
  { label: "₹3,000–6,000", min: 3000, max: 6000 },
  { label: "₹6,000+",      min: 6000, max: 99999 },
];

/** Client-side sort — matches web's sort logic */
function sortLodges(lodges: Lodge[], sort: string): Lodge[] {
  const copy = [...lodges];
  if (sort === "price-low")  return copy.sort((a, b) => (a.starting_tariff ?? a.starting_price ?? 9999) - (b.starting_tariff ?? b.starting_price ?? 9999));
  if (sort === "price-high") return copy.sort((a, b) => (b.starting_tariff ?? b.starting_price ?? 0) - (a.starting_tariff ?? a.starting_price ?? 0));
  if (sort === "rating")     return copy.sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0));
  return copy; // recommended = server order
}

export default function Search() {
  const router   = useRouter();
  const params   = useLocalSearchParams();
  const { customer } = useAuth();

  const [cityInput,    setCityInput]    = useState((params.city as string) || "");
  const [results,      setResults]      = useState<Lodge[]>([]);
  const [count,        setCount]        = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [savedCodes,   setSavedCodes]   = useState<Set<string>>(new Set());
  const [sort,         setSort]         = useState("recommended");
  const [propType,     setPropType]     = useState("");
  const [pricePreset,  setPricePreset]  = useState(0); // index into PRICE_PRESETS
  const [filtersOpen,  setFiltersOpen]  = useState(false);

  // Load wishlist
  useEffect(() => {
    if (!customer) return;
    rustoWishlist.list()
      .then(r => setSavedCodes(new Set((r.data.saved || []).map((w: any) => w.code))))
      .catch(() => {});
  }, [customer]);

  const handleSave = useCallback(async (code: string) => {
    if (!customer) { router.push("/signin"); return; }
    const wasSaved = savedCodes.has(code);
    setSavedCodes(prev => {
      const next = new Set(prev);
      wasSaved ? next.delete(code) : next.add(code);
      return next;
    });
    try {
      if (wasSaved) await rustoWishlist.unsave(code);
      else          await rustoWishlist.save(code);
    } catch {
      setSavedCodes(prev => {
        const next = new Set(prev);
        wasSaved ? next.add(code) : next.delete(code);
        return next;
      });
    }
  }, [customer, savedCodes, router]);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const q: any = {};
      if (cityInput.trim())  q.city  = cityInput.trim();
      if (params.from)       q.from   = params.from;
      if (params.to)         q.to     = params.to;
      if (params.rooms)      q.rooms  = +(params.rooms as string);
      if (params.guests)     q.guests = +(params.guests as string);
      if (propType)          q.property_type = propType;
      const preset = PRICE_PRESETS[pricePreset];
      if (preset && preset.max > 0) {
        q.min_price = preset.min;
        q.max_price = preset.max;
      }
      const r = await rustoPublic.search(q);
      setResults(r.data.lodges || []);
      setCount(r.data.count   || 0);
    } catch {
      setResults([]); setCount(0);
    } finally { setLoading(false); setRefreshing(false); }
  }, [cityInput, params.from, params.to, params.rooms, params.guests, propType, pricePreset]);

  useEffect(() => {
    if (params.city && params.city !== cityInput) {
      setCityInput(params.city as string);
    }
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.city, params.from, params.to, params.rooms, params.guests]);

  // Re-search when filters change
  useEffect(() => { search(); }, [propType, pricePreset]);

  const sorted  = sortLodges(results, sort);
  const activeFilters = (propType ? 1 : 0) + (pricePreset > 0 ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink50 }}>

      {/* ── Sticky search bar ─────────────────────────────────────────────── */}
      <View style={styles.searchBar}>
        <SearchIcon size={16} color={colors.gold}/>
        <TextInput
          value={cityInput}
          onChangeText={setCityInput}
          onSubmitEditing={search}
          placeholder="City or location"
          placeholderTextColor={colors.ink400}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
        />
        <Pressable
          onPress={search}
          style={({ pressed }) => [styles.goBtn, pressed && { opacity: 0.85 }]}>
          <Text style={styles.goBtnText}>Go</Text>
        </Pressable>
      </View>

      {/* ── Filter bar (sort + filters) ───────────────────────────────────── */}
      <View style={styles.filterBar}>
        {/* Sort picker */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: spacing.md }}>
          {SORT_OPTIONS.map(opt => (
            <Pressable
              key={opt.value}
              onPress={() => setSort(opt.value)}
              style={[styles.sortChip, sort === opt.value && styles.sortChipActive]}>
              <Text style={[styles.sortChipText, sort === opt.value && styles.sortChipTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}

          {/* Filter button */}
          <Pressable
            onPress={() => setFiltersOpen(true)}
            style={[styles.filterBtn, activeFilters > 0 && styles.filterBtnActive]}>
            <SlidersHorizontal size={13} color={activeFilters > 0 ? colors.navyDark : colors.ink500}/>
            <Text style={[styles.filterBtnText, activeFilters > 0 && { color: colors.navyDark }]}>
              Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {loading ? (
        <Loading message="Searching…"/>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.huge }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); search(); }}
              tintColor={colors.gold}
            />
          }>
          <View style={{ marginBottom: spacing.md }}>
            <Eyebrow>Lodges</Eyebrow>
            <Text style={styles.heading}>
              {count > 0 ? `${count} found` : "No matches"}
              {cityInput && count > 0
                ? <Text style={styles.subHeading}>  in {cityInput}</Text>
                : null}
            </Text>
          </View>

          {sorted.length === 0 ? (
            <View style={styles.empty}>
              <SearchIcon size={36} color={colors.ink300}/>
              <Text style={styles.emptyTitle}>No lodges found</Text>
              <Text style={styles.emptyDesc}>Try a different city or adjust filters.</Text>
              <View style={{ marginTop: 16 }}>
                <Button
                  title="Clear filters"
                  variant="outline"
                  onPress={() => {
                    setCityInput("");
                    setPropType("");
                    setPricePreset(0);
                    router.setParams({ city: "" } as any);
                  }}
                />
              </View>
            </View>
          ) : (
            sorted.map(l => (
              <LodgeCard
                key={l.code}
                lodge={l}
                saved={savedCodes.has(l.code)}
                onSave={handleSave}
                query={{
                  from:   params.from as string,
                  to:     params.to as string,
                  rooms:  params.rooms  ? +(params.rooms  as string) : undefined,
                  guests: params.guests ? +(params.guests as string) : undefined,
                }}
              />
            ))
          )}
        </ScrollView>
      )}

      {/* ── Filters modal ────────────────────────────────────────────────── */}
      <Modal
        visible={filtersOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setFiltersOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setFiltersOpen(false)}/>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle}/>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Filters</Text>
            <TouchableOpacity onPress={() => setFiltersOpen(false)}>
              <X size={20} color={colors.ink500}/>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.huge }}>
            {/* Property type */}
            <Text style={styles.filterLabel}>Property type</Text>
            <View style={styles.chipRow}>
              {PROPERTY_TYPES.map(pt => (
                <Pressable
                  key={pt.value}
                  onPress={() => setPropType(pt.value)}
                  style={[styles.filterChip, propType === pt.value && styles.filterChipActive]}>
                  <Text style={[
                    styles.filterChipText,
                    propType === pt.value && styles.filterChipTextActive,
                  ]}>
                    {pt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Price range */}
            <Text style={[styles.filterLabel, { marginTop: spacing.lg }]}>Price per night</Text>
            <View style={styles.chipRow}>
              {PRICE_PRESETS.map((p, i) => (
                <Pressable
                  key={i}
                  onPress={() => setPricePreset(i)}
                  style={[styles.filterChip, pricePreset === i && styles.filterChipActive]}>
                  <Text style={[
                    styles.filterChipText,
                    pricePreset === i && styles.filterChipTextActive,
                  ]}>
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <View style={{ padding: spacing.lg, gap: 8 }}>
            <Button
              title="Apply filters"
              variant="gold"
              fullWidth
              onPress={() => { setFiltersOpen(false); search(); }}
            />
            <Button
              title="Clear all"
              variant="outline"
              fullWidth
              onPress={() => { setPropType(""); setPricePreset(0); setFiltersOpen(false); }}
            />
          </View>
        </View>
      </Modal>
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
  goBtn: {
    backgroundColor: colors.gold,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderRadius: radius.md,
  },
  goBtnText: { color: colors.navyDark, fontWeight: "700", fontSize: 13 },

  filterBar: {
    backgroundColor: colors.white,
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.ink100,
  },
  sortChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1.5, borderColor: colors.ink200,
    backgroundColor: colors.white,
  },
  sortChipActive: {
    backgroundColor: colors.navyDark,
    borderColor: colors.navyDark,
  },
  sortChipText:       { fontSize: 12, color: colors.ink600, fontWeight: "600" },
  sortChipTextActive: { color: colors.white },
  filterBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1.5, borderColor: colors.ink200,
    backgroundColor: colors.white,
  },
  filterBtnActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  filterBtnText: { fontSize: 12, color: colors.ink600, fontWeight: "600" },

  heading:    { fontSize: 22, fontWeight: "700", color: colors.navy, marginTop: 4 },
  subHeading: { fontSize: 16, fontWeight: "400", color: colors.ink500 },

  empty: {
    backgroundColor: colors.white, borderRadius: radius.lg,
    padding: spacing.huge, alignItems: "center",
    borderWidth: 1, borderColor: colors.ink100,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.navy, marginTop: 12 },
  emptyDesc:  { fontSize: 13, color: colors.ink500, marginTop: 4, textAlign: "center" },

  // Modal
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7,19,28,0.6)",
  },
  modalSheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    maxHeight: "80%",
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.ink200, alignSelf: "center",
    marginTop: spacing.sm, marginBottom: spacing.md,
  },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.ink100,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.navy },

  filterLabel: { fontSize: 13, fontWeight: "700", color: colors.navy, marginBottom: spacing.sm },
  chipRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1.5, borderColor: colors.ink200,
    backgroundColor: colors.white,
  },
  filterChipActive: {
    backgroundColor: colors.navyDark,
    borderColor: colors.navyDark,
  },
  filterChipText:       { fontSize: 12, color: colors.ink700, fontWeight: "600" },
  filterChipTextActive: { color: colors.white },
});
