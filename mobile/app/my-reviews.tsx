import React, { useState, useCallback } from "react";
import {
  ScrollView, View, Text, StyleSheet, Alert,
  RefreshControl, Pressable,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Star, Edit2, Trash2, MessageSquare } from "lucide-react-native";
import { colors, spacing } from "@/theme";
import { useAuth } from "@/context/AuthContext";
import { rustoReviews, Review } from "@/api/rusto";
import { Button, Card, EmptyState, Loading, Input } from "@/components/UI";
import { tinyDate, errorMessage } from "@/lib/format";

/**
 * My Reviews screen — list, edit, delete reviews submitted by the customer.
 */
export default function MyReviews() {
  const { customer, loading: authLoading } = useAuth();
  const router = useRouter();
  const [reviews,    setReviews]    = useState<Review[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing,    setEditing]    = useState<Review | null>(null);
  const [editBody,   setEditBody]   = useState("");
  const [editRating, setEditRating] = useState(5);
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await rustoReviews.mine();
      const list = Array.isArray(r.data) ? r.data : (r.data as any).reviews ?? [];
      setReviews(list);
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    if (customer) load();
  }, [customer, load]));

  const startEdit = (rev: Review) => {
    setEditing(rev);
    setEditBody(rev.body ?? "");
    setEditRating(rev.rating);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      await rustoReviews.edit(editing.review_id, { rating: editRating, body: editBody });
      setEditing(null);
      load();
    } catch (e) {
      Alert.alert("Failed to save", errorMessage(e));
    } finally { setSavingEdit(false); }
  };

  const deleteReview = (rev: Review) => {
    Alert.alert(
      "Delete review?",
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
          try {
            await rustoReviews.delete(rev.review_id);
            setReviews(rs => rs.filter(r => r.review_id !== rev.review_id));
          } catch (e) { Alert.alert("Failed", errorMessage(e)); }
        }},
      ]
    );
  };

  if (authLoading) return <Loading message="Loading..."/>;
  if (!customer) return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl }}>
      <EmptyState
        icon={<MessageSquare size={36} color={colors.ink300}/>}
        title="Sign in to view your reviews"
        action={() => router.push("/signin")}
        actionLabel="Sign in"
      />
    </View>
  );

  if (loading) return <Loading message="Loading reviews..."/>;

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.huge }}
      refreshControl={
        <RefreshControl refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.gold}/>
      }>

      {/* Edit modal */}
      {editing && (
        <Card style={{ marginBottom: spacing.lg, borderColor: colors.gold, borderWidth: 2 }}>
          <Text style={styles.editTitle}>Edit review for {editing.lodge_name}</Text>
          <StarRating value={editRating} onChange={setEditRating}/>
          <Input
            label="Your review"
            value={editBody}
            onChangeText={setEditBody}
            multiline
            numberOfLines={4}
            placeholder="Share your experience..."
            style={{ minHeight: 80, textAlignVertical: "top" }}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="Save" variant="gold" fullWidth loading={savingEdit} onPress={saveEdit}/>
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="outline" fullWidth onPress={() => setEditing(null)}/>
            </View>
          </View>
        </Card>
      )}

      {reviews.length === 0 ? (
        <EmptyState
          icon={<Star size={36} color={colors.ink300}/>}
          title="No reviews yet"
          description="After a completed stay, share your experience to help other travellers."
          action={() => router.push("/(tabs)/search" as any)}
          actionLabel="Book a stay"
        />
      ) : (
        reviews.map(rev => (
          <Card key={rev.review_id} style={{ marginBottom: spacing.md }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lodgeName}>{rev.lodge_name}</Text>
                <Text style={styles.reviewDate}>{tinyDate(rev.created_at)}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Pressable onPress={() => startEdit(rev)} hitSlop={8} accessibilityLabel="Edit review">
                  <Edit2 size={14} color={colors.ink400}/>
                </Pressable>
                <Pressable onPress={() => deleteReview(rev)} hitSlop={8} accessibilityLabel="Delete review">
                  <Trash2 size={14} color={colors.danger}/>
                </Pressable>
              </View>
            </View>
            <View style={{ flexDirection: "row", marginTop: spacing.sm, gap: 2 }}>
              {[1,2,3,4,5].map(i => (
                <Star key={i} size={14}
                  color={i <= rev.rating ? "#F59E0B" : colors.ink200}
                  fill={i <= rev.rating ? "#F59E0B" : "transparent"}
                />
              ))}
            </View>
            {rev.body ? <Text style={styles.reviewBody}>{rev.body}</Text> : null}
          </Card>
        ))
      )}
    </ScrollView>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: spacing.md, justifyContent: "center" }}>
      {[1,2,3,4,5].map(i => (
        <Pressable key={i} onPress={() => onChange(i)} hitSlop={4}>
          <Star size={32}
            color={i <= value ? "#F59E0B" : colors.ink200}
            fill={i <= value ? "#F59E0B" : "transparent"}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  editTitle:   { fontSize: 14, fontWeight: "700", color: colors.navy, marginBottom: spacing.md },
  lodgeName:   { fontSize: 15, fontWeight: "700", color: colors.navy },
  reviewDate:  { fontSize: 11, color: colors.ink400, marginTop: 2 },
  reviewBody:  { fontSize: 13, color: colors.ink700, lineHeight: 20, marginTop: spacing.sm },
});
