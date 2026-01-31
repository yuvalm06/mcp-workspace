import { supabase } from '../services/supabase';

// Get API URL from environment or use defaults
const API_BASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

// Always log the API URL for debugging
console.log('[API] Base URL:', API_BASE_URL);
console.log('[API] __DEV__:', __DEV__);
console.log('[API] EXPO_PUBLIC_SUPABASE_URL:', process.env.EXPO_PUBLIC_SUPABASE_URL || 'not set');

export const apiClient = {
  get: async <T = any>(path: string, options = {}) => {
    const { data, error } = await supabase.functions.invoke('study-logic', {
      method: 'GET',
      headers: {
        'x-path': path,
      },
      ...options,
    });
    if (error) throw error;
    return { data: data as T };
  },
  post: async <T = any>(path: string, body?: any, options = {}) => {
    const { data, error } = await supabase.functions.invoke('study-logic', {
      method: 'POST',
      headers: {
        'x-path': path,
      },
      body,
      ...options,
    });
    if (error) throw error;
    return { data: data as T };
  },
  delete: async <T = any>(path: string, options = {}) => {
    const { data, error } = await supabase.functions.invoke('study-logic', {
      method: 'DELETE',
      headers: {
        'x-path': path,
      },
      ...options,
    });
    if (error) throw error;
    return { data: data as T };
  },
};

export default apiClient;
