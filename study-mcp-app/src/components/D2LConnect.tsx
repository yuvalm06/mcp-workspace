import React, { useRef } from 'react';
import { View, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { supabase } from '../services/supabase';

const D2LConnect = () => {
  const webViewRef = useRef(null);

  const handleNavigationStateChange = async (navState) => {
    if (navState.url.includes('dashboard')) {
      const injectedJavaScript = `
        (function() {
          const cookies = document.cookie.split('; ').reduce((acc, cookie) => {
            const [key, value] = cookie.split('=');
            acc[key] = value;
            return acc;
          }, {});
          if (cookies.d2lSessionVal && cookies.d2lSecureSessionVal) {
            window.ReactNativeWebView.postMessage(JSON.stringify(cookies));
          }
        })();
      `;
      webViewRef.current.injectJavaScript(injectedJavaScript);
    }
  };

  const handleMessage = async (event) => {
    const cookies = JSON.parse(event.nativeEvent.data);
    const host = new URL(event.nativeEvent.url).host;

    try {
      await supabase.functions.invoke('study-logic', {
        method: 'POST',
        path: '/d2l/connect-cookie',
        body: { cookies, host },
        headers: { 'Content-Type': 'application/json' },
      });
      Alert.alert('Success', 'D2L connected successfully!');
    } catch (error) {
      console.error('Failed to connect D2L:', error);
      Alert.alert('Error', 'Failed to connect to D2L.');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://your-school-portal-url' }}
        onNavigationStateChange={handleNavigationStateChange}
        onMessage={handleMessage}
        javaScriptEnabled
      />
    </View>
  );
};

export default D2LConnect;