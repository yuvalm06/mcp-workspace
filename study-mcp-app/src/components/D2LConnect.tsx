import React, { useRef } from 'react';
import { View, Alert } from 'react-native';
import { WebView, WebViewNavigation, WebViewMessageEvent } from 'react-native-webview';
import { apiClient } from '../config/api';

const D2LConnect = () => {
  const webViewRef = useRef<WebView>(null);

  const handleNavigationStateChange = (navState: WebViewNavigation) => {
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
      webViewRef.current?.injectJavaScript(injectedJavaScript);
    }
  };

  const handleMessage = async (event: WebViewMessageEvent) => {
    const cookies = JSON.parse(event.nativeEvent.data);
    const host = new URL(event.nativeEvent.url).host;

    try {
      await apiClient.post('/d2l/connect-cookie', { cookies, host });
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
        source={{ uri: 'https://learn.uwaterloo.ca' }}
        onNavigationStateChange={handleNavigationStateChange}
        onMessage={handleMessage}
        javaScriptEnabled
      />
    </View>
  );
};

export default D2LConnect;
