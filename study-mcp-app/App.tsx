import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { supabase } from './src/lib/supabase';
import { Session } from '@supabase/supabase-js';
import AuthStack from './src/navigation/AuthStack';
import MainTabs from './src/navigation/MainTabs';
import { AuthProvider } from './src/context/AuthContext';
import { LogBox } from 'react-native';

LogBox.ignoreLogs([
  '+[UIInputViewSetPlacementInvisible placementWithPlacement:]: Should not be called with an invisible placement',
]);

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth State Changed:', event, session);
      setSession(session);
    });

    // Cleanup subscription on unmount
    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  if (loading) {
    return null; // Or a splash screen
  }

  console.log('Current Session User:', session?.user?.email);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer key={session ? 'authenticated' : 'unauthenticated'}>
          {session ? <MainTabs /> : <AuthStack />}
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
