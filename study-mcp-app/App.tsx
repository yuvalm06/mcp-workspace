import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import { registerForPushNotifications, setupNotificationListeners, getLastNotificationResponse } from './src/services/push';
import { useNavigation } from '@react-navigation/native';
import { supabase } from './src/lib/supabase'; // Corrected import to match named export

function AppContent() {
  const { isAuthenticated } = useAuth();
  const navigationRef = useRef<any>(null);
  const notificationListener = useRef<any>(null);
  const responseListener = useRef<any>(null);

  useEffect(() => {
    if (isAuthenticated && supabase?.auth) {
      registerForPushNotifications().then((token) => {
        if (token) {
          console.log('[APP] Push notification token:', token);
        }
      });

      notificationListener.current = setupNotificationListeners(
        (notification) => {
          console.log('[APP] Notification received:', notification);
        },
        (response) => {
          console.log('[APP] Notification tapped:', response);
          const data = response.notification.request.content.data;
          if (data?.type === 'announcement' && data?.courseId) {
            // Navigate to course detail
          } else if (data?.type === 'assignment' && data?.courseId) {
            // Navigate to course detail
          }
        }
      );

      getLastNotificationResponse().then((response) => {
        if (response) {
          console.log('[APP] App opened from notification:', response);
          const data = response.notification.request.content.data;
        }
      });
    }

    return () => {
      if (notificationListener.current) {
        notificationListener.current();
      }
      if (responseListener.current) {
        responseListener.current();
      }
    };
  }, [isAuthenticated]);

  return <AppNavigator />;
}

export default function App() {
  useEffect(() => {
    supabase.auth.getSession().then((session) => {
      if (session) {
        console.log('[APP] Supabase session initialized:', session);
      }
    });
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppContent />
        <StatusBar style="auto" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
