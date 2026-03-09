import React, { useState, useEffect } from 'react';
import { TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { AntDesign } from '@expo/vector-icons';
import { bookmarksService, BookmarkType } from '../services/bookmarks';
import { colors } from '../theme';

interface BookmarkButtonProps {
  type: BookmarkType;
  refId: string;
  title: string;
  url?: string;
  metadata?: Record<string, any>;
  size?: number;
  initialBookmarkId?: string | null;
  onToggle?: (bookmarked: boolean, bookmarkId?: string) => void;
}

export default function BookmarkButton({
  type,
  refId,
  title,
  url,
  metadata,
  size = 20,
  initialBookmarkId = null,
  onToggle,
}: BookmarkButtonProps) {
  const [bookmarkId, setBookmarkId] = useState<string | null>(initialBookmarkId);
  const [loading, setLoading] = useState(false);

  const handlePress = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await bookmarksService.toggleBookmark(
        { type, ref_id: refId, title, url, metadata },
        bookmarkId || undefined
      );
      setBookmarkId(result.bookmarked ? (result.bookmark?.id ?? null) : null);
      onToggle?.(result.bookmarked, result.bookmark?.id);
    } catch (e) {
      console.error('[Bookmark] toggle error:', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <ActivityIndicator
        size="small"
        color={colors.accent}
        style={{ width: size + 8, height: size + 8 }}
      />
    );
  }

  return (
    <TouchableOpacity onPress={handlePress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <AntDesign
        name={bookmarkId ? 'star' : 'staro'}
        size={size}
        color={bookmarkId ? colors.sun : colors.muted}
      />
    </TouchableOpacity>
  );
}
