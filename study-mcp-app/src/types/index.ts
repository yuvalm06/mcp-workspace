// API Response Types
export interface PresignUploadRequest {
  filename: string;
  contentType: string;
  size: number;
  courseId?: string;
}

export interface PresignUploadResponse {
  uploadUrl: string;
  path: string; // Changed from s3Key to path for Supabase
}

export interface ProcessNoteRequest {
  storagePath: string;
  title: string;
  courseId?: string;
}

export interface ProcessNoteResponse {
  noteId: string;
  status: string;
  chunkCount: number;
  pageCount: number;
  embedded: number;
}

export interface Note {
  id: string;
  title: string;
  courseId?: string;
  course_id?: string; // Support for snake_case from DB
  createdAt: string;
  created_at?: string; // Support for snake_case from DB
  updatedAt: string;
  updated_at?: string; // Support for snake_case from DB
  pageCount?: number;
  page_count?: number; // Support for snake_case from DB
  chunkCount?: number;
  status?: string;
}

export interface SearchHit {
  sectionId: string;
  noteId: string;
  title: string;
  snippet: string;
  url?: string;
  anchor?: string;
  score: number;
  courseId?: string;
}

export interface SearchResponse {
  hits: SearchHit[];
}

export interface DashboardResponse {
  recentNotes: Note[];
  usage: {
    totalChunks: number;
  };
  stats: {
    notesCount: number;
  };
}

// Auth Types
export interface User {
  id: string;
  email?: string;
  name?: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Simple internal normalizeDate since the external import was broken
export function normalizeDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toISOString();
  } catch (e) {
    return dateStr;
  }
}
