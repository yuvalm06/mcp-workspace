import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { AntDesign } from '@expo/vector-icons';
import { apiClient } from '../config/api';
import { colors } from '../theme';

interface Bookmark {
  id: string;
  type: string;
  ref_id: string;
  title: string;
  url?: string;
  metadata?: any;
  created_at: string;
}

const TYPE_ICONS: Record<string, string> = {
  note: 'filetext1',
  piazza_post: 'message1',
  announcement: 'notification',
  assignment: 'calendar',
};

export default function BookmarksScreen() {
  const [bookmarks, setBookmarks] = React.useState<Bookmark[]>([]);
  const [loading, setLoading] = React.useState(true);

  const loadBookmarks = async () => {
    try {
      const res = await apiClient.get('/bookmarks');
      setBookmarks(res.data.bookmarks || []);
    } catch (e: any) {
      console.error('Bookmarks load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { loadBookmarks(); }, []));

  const removeBookmark = (id: string, refId: string, type: string) => {
    Alert.alert('Remove Bookmark', 'Remove this bookmark?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/bookmarks/${id}`);
            setBookmarks(b => b.filter(x => x.id !== id));
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        }
      }
    ]);
  };

  const renderItem = ({ item }: { item: Bookmark }) => (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <AntDesign name={(TYPE_ICONS[item.type] || 'link') as any} size={20} color={colors.accent} />
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.cardType}>{item.type.replace('_', ' ')}</Text>
        <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
      </View>
      <TouchableOpacity onPress={() => removeBookmark(item.id, item.ref_id, item.type)}>
        <AntDesign name="delete" size={18} color="#94a3b8" />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Bookmarks</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : bookmarks.length === 0 ? (
        <View style={styles.center}>
          <AntDesign name="star" size={56} color={colors.border} />
          <Text style={styles.emptyHeader}>No bookmarks yet</Text>
          <Text style={styles.emptySubtext}>Bookmark notes, assignments, and posts to find them here</Text>
        </View>
      ) : (
        <FlatList
          data={bookmarks}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16,
    backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  list: { padding: 16 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: colors.border, gap: 12,
  },
  cardLeft: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#eef2ff', justifyContent: 'center', alignItems: 'center',
  },
  cardContent: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 2 },
  cardType: { fontSize: 12, color: colors.accent, fontWeight: '500', marginBottom: 2, textTransform: 'capitalize' },
  cardDate: { fontSize: 11, color: colors.muted },
  emptyHeader: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 16 },
  emptySubtext: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 8 },
});
