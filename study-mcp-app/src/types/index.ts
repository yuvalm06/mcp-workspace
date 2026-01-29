// API Response Types
export interface PresignUploadRequest {
  filename: string;
  contentType: string;
  size: number;
  courseId?: string;
}

export interface PresignUploadResponse {
  uploadUrl: string;
  s3Key: string;
}

export interface ProcessNoteRequest {
  s3Key: string;
  courseId?: string;
  title?: string;
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
  createdAt: string;
  updatedAt: string;
  pageCount?: number;
  chunkCount?: number;
  status?: string;

  normalizeDates(): void;
}

// Extend Note to include normalization logic
export class NoteWithNormalization implements Note {
  id: string = '';
  title: string = '';
  courseId?: string;
  createdAt: string = '';
  updatedAt: string = '';
  pageCount?: number;
  chunkCount?: number;
  status?: string;

  constructor(note: Note) {
    Object.assign(this, note);
    this.normalizeDates();
  }

  normalizeDates(): void {
    this.createdAt = normalizeDate(this.createdAt) || this.createdAt;
    this.updatedAt = normalizeDate(this.updatedAt) || this.updatedAt;
  }
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

// Added normalizeDate utility for date handling
import { normalizeDate } from '../../../d2l-mcp/src/utils/marshal';
