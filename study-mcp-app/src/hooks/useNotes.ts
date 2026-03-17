import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

export interface Note {
  id: string;
  user_id: string;
  title: string | null;
  content: string | null;
  s3_key: string | null;
  course_id: string | null;
  status: string | null;
  page_count: number | null;
  created_at: string;
}

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
        setNotes(data as Note[]);
      }
      setLoading(false);
    };

    fetchNotes();

    // Supabase v2 realtime API
    const channel = supabase
      .channel('notes-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes' },
        (payload) => setNotes((prev) => [...prev, payload.new as Note]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes' },
        (payload) => setNotes((prev) =>
          prev.map((note) => (note.id === (payload.new as Note).id ? payload.new as Note : note))))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes' },
        (payload) => setNotes((prev) => prev.filter((note) => note.id !== (payload.old as Note).id)))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { notes, loading };
};
