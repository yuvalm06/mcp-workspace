import { supabase } from '../services/supabase';

// Get API URL from environment or use defaults
const API_BASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

// Always log the API URL for debugging
console.log('[API] Base URL:', API_BASE_URL);
console.log('[API] __DEV__:', __DEV__);
console.log('[API] EXPO_PUBLIC_SUPABASE_URL:', process.env.EXPO_PUBLIC_SUPABASE_URL || 'not set');

export const apiClient = {
  get: async (path, options) => {
    const { data, error } = await supabase.functions.invoke('study-logic', {
      method: 'GET',
      path,
      ...options,
    });
    if (error) throw error;
    return { data };
  },
  post: async (path, body, options) => {
    const { data, error } = await supabase.functions.invoke('study-logic', {
      method: 'POST',
      path,
      body,
      ...options,
    });
    if (error) throw error;
    return { data };
  },
};

export default apiClient;
