import { apiClient } from '../config/api';

export type BookmarkType = 'note' | 'piazza_post' | 'announcement' | 'assignment';

export interface Bookmark {
  id: string;
  type: BookmarkType;
  ref_id: string;
  title: string;
  url?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export class BookmarksService {
  async getBookmarks(type?: BookmarkType): Promise<Bookmark[]> {
    const params = type ? { type } : {};
    const response = await apiClient.get('/bookmarks', { params });
    return (response.data as any).bookmarks || [];
  }

  async addBookmark(data: {
    type: BookmarkType;
    ref_id: string;
    title: string;
    url?: string;
    metadata?: Record<string, any>;
  }): Promise<Bookmark> {
    const response = await apiClient.post('/bookmarks', data);
    return (response.data as any).bookmark;
  }

  async removeBookmark(id: string): Promise<void> {
    await apiClient.delete(`/bookmarks/${id}`);
  }

  async toggleBookmark(data: {
    type: BookmarkType;
    ref_id: string;
    title: string;
    url?: string;
    metadata?: Record<string, any>;
  }, currentBookmarkId?: string): Promise<{ bookmarked: boolean; bookmark?: Bookmark }> {
    if (currentBookmarkId) {
      await this.removeBookmark(currentBookmarkId);
      return { bookmarked: false };
    } else {
      const bookmark = await this.addBookmark(data);
      return { bookmarked: true, bookmark };
    }
  }

  async isBookmarked(type: BookmarkType, ref_id: string): Promise<string | null> {
    try {
      const all = await this.getBookmarks(type);
      const found = all.find(b => b.ref_id === String(ref_id));
      return found ? found.id : null;
    } catch {
      return null;
    }
  }
}

export const bookmarksService = new BookmarksService();
