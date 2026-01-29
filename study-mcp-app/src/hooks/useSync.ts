import { useState } from 'react';
import { supabase } from '../services/supabase';

export const useSync = () => {
  const [syncing, setSyncing] = useState(false);

  const syncD2L = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('study-logic', {
        method: 'POST',
        path: '/d2l/sync',
      });
      if (error) {
        console.error('Error syncing D2L:', error);
      } else {
        console.log('D2L sync complete:', data);
      }
    } catch (error) {
      console.error('Unexpected error during D2L sync:', error);
    } finally {
      setSyncing(false);
    }
  };

  return { syncD2L, syncing };
};