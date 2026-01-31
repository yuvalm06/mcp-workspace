import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { Database } from '@/types/supabase';

type Note = Database['public']['Tables']['notes']['Row'];

export const useNotes = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNotes = async () => {
      setLoading(true);
      const { data, error } = await supabase.from('notes').select('*');
      if (error) {
        console.error('Error fetching notes:', error);
      } else {
        setNotes(data);
      }
      setLoading(false);
    };

    fetchNotes();

    const subscription = supabase
      .from('notes')
      .on('INSERT', (payload) => setNotes((prev) => [...prev, payload.new]))
      .on('UPDATE', (payload) =>
        setNotes((prev) =>
          prev.map((note) => (note.id === payload.new.id ? payload.new : note))
        )
      )
      .on('DELETE', (payload) =>
        setNotes((prev) => prev.filter((note) => note.id !== payload.old.id))
      )
      .subscribe();

    return () => {
      supabase.removeSubscription(subscription);
    };
  }, []);

  return { notes, loading };
};