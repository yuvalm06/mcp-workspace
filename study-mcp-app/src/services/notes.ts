import { apiClient } from '../config/api';
import { supabase } from './supabase';
import {
  PresignUploadRequest,
  PresignUploadResponse,
  ProcessNoteRequest,
  ProcessNoteResponse,
  Note,
} from '../types';

export class NotesService {
  async presignUpload(data: PresignUploadRequest): Promise<PresignUploadResponse> {
    const response = await apiClient.post<PresignUploadResponse>(
      '/api/notes/presign-upload',
      data
    );
    return response.data;
  }

  async processNote(data: ProcessNoteRequest): Promise<ProcessNoteResponse> {
    const response = await apiClient.post<ProcessNoteResponse>(
      '/api/notes/process',
      data
    );
    return response.data;
  }

  async getNotes(courseId?: string): Promise<Note[]> {
    const params = courseId ? { courseId } : {};
    const response = await apiClient.get<{ notes: Note[] }>('/api/notes', { params });
    return response.data.notes || [];
  }

  async deleteNote(noteId: string): Promise<void> {
    const response = await apiClient.delete<{ status: string; noteId: string }>(
      `/api/notes/${noteId}`
    );
    if (response.status !== 200) {
      throw new Error(response.data?.status || 'Failed to delete note');
    }
  }

  async uploadFile(
    uploadUrl: string,
    fileUri: string,
    contentType: string
  ): Promise<void> {
    // Read file and upload to S3
    const response = await fetch(fileUri);
    const blob = await response.blob();

    await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': contentType,
      },
    });
  }

  /**
   * Embed missing note sections
   * Triggers embedding generation for notes that haven't been embedded yet
   */
  async embedMissing(): Promise<{ status: string; message: string }> {
    const response = await apiClient.post<{ status: string; message: string }>(
      '/api/notes/embed-missing'
    );
    return response.data;
  }

  /**
   * Search notes using semantic search
   */
  async searchNotes(query: string, courseId?: string): Promise<any[]> {
    const params: any = { q: query };
    if (courseId) {
      params.courseId = courseId;
    }
    const response = await apiClient.get<{ hits: any[] }>('/api/search', { params });
    return response.data.hits || [];
  }
}

export const notesService = new NotesService();

export const getDashboard = async () => {
  const { data, error } = await supabase.functions.invoke('study-logic', {
    method: 'GET',
    path: '/dashboard',
  });

  if (error) {
    console.error('Failed to fetch dashboard:', error);
    throw error;
  }

  return data;
};

export const searchNotes = async (query: string) => {
  const { data, error } = await supabase.functions.invoke('study-logic', {
    method: 'GET',
    path: `/search?q=${encodeURIComponent(query)}`,
  });

  if (error) {
    console.error('Failed to search notes:', error);
    throw error;
  }

  return data;
};

export const presignUpload = async (filename: string, contentType: string, size: number) => {
  const { data, error } = await supabase.functions.invoke('study-logic', {
    method: 'POST',
    path: '/notes/presign-upload',
    body: { filename, contentType, size },
    headers: { 'Content-Type': 'application/json' },
  });

  if (error) {
    console.error('Failed to get presigned upload URL:', error);
    throw error;
  }

  return data;
};
