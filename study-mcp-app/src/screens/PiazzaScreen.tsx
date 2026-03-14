import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { AntDesign } from '@expo/vector-icons';
import { apiClient } from '../config/api';
import { colors } from '../theme';

interface PiazzaPost {
  id: string;
  post_id: string;
  course_id: string;
  course_name: string;
  title: string;
  body: string;
  post_type: string;
  created_at: string;
}

export default function PiazzaScreen() {
  const [posts, setPosts] = useState<PiazzaPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigation = useNavigation<any>();

  const loadPosts = async () => {
    try {
      setError(null);
      const res = await apiClient.get('/piazza/posts');
      setPosts(res.data.posts || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load Piazza posts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { loadPosts(); }, []));

  const renderPost = ({ item }: { item: PiazzaPost }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.typeBadge, item.post_type === 'question' ? styles.questionBadge : styles.noteBadge]}>
          <Text style={styles.typeText}>{item.post_type === 'question' ? 'Q' : 'N'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.cardCourse}>{item.course_name || item.course_id}</Text>
        </View>
      </View>
      {!!item.body && (
        <Text style={styles.cardBody} numberOfLines={3}>{item.body}</Text>
      )}
      <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Piazza</Text>
        <TouchableOpacity onPress={() => navigation.navigate('PiazzaConnect')}>
          <AntDesign name="setting" size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <AntDesign name="warning" size={40} color="#f59e0b" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadPosts}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.center}>
          <AntDesign name="message1" size={56} color={colors.border} />
          <Text style={styles.emptyHeader}>No posts yet</Text>
          <Text style={styles.emptySubtext}>Connect Piazza and sync to see your course discussions</Text>
          <TouchableOpacity style={styles.connectButton} onPress={() => navigation.navigate('PiazzaConnect')}>
            <Text style={styles.connectButtonText}>Connect Piazza</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={posts}
          renderItem={renderPost}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadPosts(); }} tintColor={colors.accent} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16,
    backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  list: { padding: 16 },
  card: {
    backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 12 },
  typeBadge: {
    width: 28, height: 28, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  questionBadge: { backgroundColor: '#eef2ff' },
  noteBadge: { backgroundColor: '#f0fdf4' },
  typeText: { fontSize: 12, fontWeight: '800', color: colors.accent },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 2 },
  cardCourse: { fontSize: 12, color: colors.accent, fontWeight: '500' },
  cardBody: { fontSize: 13, color: colors.muted, lineHeight: 18, marginBottom: 8 },
  cardDate: { fontSize: 11, color: colors.muted },
  errorText: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 12, marginBottom: 16 },
  retryButton: { backgroundColor: colors.accent, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyHeader: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 16 },
  emptySubtext: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 8, marginBottom: 24 },
  connectButton: { backgroundColor: colors.accent, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  connectButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
