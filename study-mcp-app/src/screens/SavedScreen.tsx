import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Linking,
  SectionList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AntDesign } from '@expo/vector-icons';
import { bookmarksService, Bookmark, BookmarkType } from '../services/bookmarks';
import BookmarkButton from '../components/BookmarkButton';
import { colors } from '../theme';

const TYPE_META: Record<BookmarkType, { label: string; icon: string; color: string }> = {
  note: { label: 'Notes', icon: 'book', color: colors.accent },
  piazza_post: { label: 'Piazza', icon: 'message1', color: colors.sun },
  announcement: { label: 'Announcements', icon: 'notification', color: colors.secondary },
  assignment: { label: 'Assignments', icon: 'checkcircleo', color: colors.info },
};

export default function SavedScreen() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<BookmarkType | null>(null);

  const loadBookmarks = useCallback(async () => {
    try {
      const data = await bookmarksService.getBookmarks(activeFilter || undefined);
      setBookmarks(data);
    } catch (e) {
      console.error('[Saved] load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    setLoading(true);
    loadBookmarks();
  }, [activeFilter]);

  const onRefresh = () => {
    setRefreshing(true);
    loadBookmarks();
  };

  const handleRemove = async (bookmark: Bookmark) => {
    try {
      await bookmarksService.removeBookmark(bookmark.id);
      setBookmarks(prev => prev.filter(b => b.id !== bookmark.id));
    } catch (e) {
      console.error('[Saved] remove error:', e);
    }
  };

  const handleOpen = (bookmark: Bookmark) => {
    if (bookmark.url) {
      Linking.openURL(bookmark.url).catch(() => {});
    }
  };

  const renderItem = ({ item }: { item: Bookmark }) => {
    const meta = TYPE_META[item.type];
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handleOpen(item)}
        activeOpacity={item.url ? 0.7 : 1}
      >
        <View style={[styles.typeIcon, { backgroundColor: meta.color + '22' }]}>
          <AntDesign name={meta.icon as any} size={18} color={meta.color} />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
          {item.metadata?.courseId && (
            <Text style={styles.cardCourse}>{item.metadata.courseId}</Text>
          )}
          {item.metadata?.snippet && (
            <Text style={styles.cardSnippet} numberOfLines={2}>{item.metadata.snippet}</Text>
          )}
          <Text style={styles.cardDate}>
            {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
        <TouchableOpacity onPress={() => handleRemove(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <AntDesign name="close" size={16} color={colors.muted} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const filters: Array<{ key: BookmarkType | null; label: string }> = [
    { key: null, label: 'All' },
    { key: 'note', label: 'Notes' },
    { key: 'piazza_post', label: 'Piazza' },
    { key: 'announcement', label: 'Announcements' },
    { key: 'assignment', label: 'Assignments' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Saved</Text>
        <Text style={styles.count}>{bookmarks.length}</Text>
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {filters.map(f => (
          <TouchableOpacity
            key={String(f.key)}
            style={[styles.chip, activeFilter === f.key && styles.chipActive]}
            onPress={() => setActiveFilter(f.key)}
          >
            <Text style={[styles.chipText, activeFilter === f.key && styles.chipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={bookmarks}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <AntDesign name="staro" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>Nothing saved yet</Text>
              <Text style={styles.emptySubtext}>
                Tap the ★ on any note, post, or announcement to save it here
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  count: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.muted,
    backgroundColor: colors.light,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.light,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  chipTextActive: { color: '#fff' },
  list: { padding: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  typeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  cardContent: { flex: 1, marginRight: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 4 },
  cardCourse: { fontSize: 12, fontWeight: '600', color: colors.accent, marginBottom: 4 },
  cardSnippet: { fontSize: 13, color: colors.muted, lineHeight: 18, marginBottom: 4 },
  cardDate: { fontSize: 11, color: colors.muted },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    marginTop: 60,
  },
  emptyText: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 16 },
  emptySubtext: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
