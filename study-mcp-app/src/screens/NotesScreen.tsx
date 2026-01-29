import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { getDashboard, searchNotes, presignUpload } from '../services/notes';
import { View, Text } from 'react-native';

const NotesScreen = () => {
  const [notes, setNotes] = useState([]);

  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const dashboard = await getDashboard();
        setNotes(dashboard.recentNotes);
      } catch (error) {
        console.error('Error fetching dashboard:', error);
      }
    };

    fetchNotes();

    const subscription = supabase
      .from('notes')
      .on('UPDATE', (payload) => {
        setNotes((prevNotes) =>
          prevNotes.map((note) =>
            note.id === payload.new.id ? { ...note, ...payload.new } : note
          )
        );
      })
      .subscribe();

    return () => {
      supabase.removeSubscription(subscription);
    };
  }, []);

  return (
    <View>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Notes</Text>
      <ul>
        {notes.map((note) => (
          <li key={note.id}>{note.title}</li>
        ))}
      </ul>
    </View>
  );
};

export default NotesScreen;
