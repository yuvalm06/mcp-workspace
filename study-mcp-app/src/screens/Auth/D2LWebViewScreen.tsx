import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import { AntDesign } from '@expo/vector-icons';
import { apiClient } from '../../config/api';

const D2L_API_VERSION = '1.57';

/** JS injected into the WebView to fetch D2L API from same origin (avoids CORS/cookie issues) */
const buildFetchScript = (host: string) => `
(async function() {
  try {
    // Fetch enrollments
    const enrollRes = await fetch('https://${host}/d2l/api/lp/1.43/enrollments/myenrollments/', {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    if (!enrollRes.ok) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: 'Enrollments fetch failed: ' + enrollRes.status }));
      return;
    }
    const enrollData = await enrollRes.json();
    const activeCourses = (enrollData.Items || []).filter(e =>
      e.OrgUnit?.Type?.Code === 'Course Offering' &&
      e.Access?.IsActive &&
      e.Access?.CanAccess
    );

    // Fetch assignments for each course
    const courseData = [];
    for (const enrollment of activeCourses) {
      const orgUnitId = enrollment.OrgUnit.Id;
      const courseName = enrollment.OrgUnit.Name;
      try {
        const foldersRes = await fetch('https://${host}/d2l/api/le/${D2L_API_VERSION}/' + orgUnitId + '/dropbox/folders/', {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
        let assignments = [];
        if (foldersRes.ok) {
          const data = await foldersRes.json();
          assignments = Array.isArray(data) ? data : (data.Objects || []);
        }
        courseData.push({ orgUnitId, name: courseName, assignments });
      } catch(e) {
        courseData.push({ orgUnitId, name: courseName, assignments: [] });
      }
    }

    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'courseData', courseData }));
  } catch(e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: e.message || String(e) }));
  }
})();
true;
`;

export default function D2LWebViewScreen({ route }: any) {
  const { host } = route.params;
  const navigation = useNavigation();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState('Please log in to D2L');

  const d2lUrl = `https://${host}/d2l/home`;

  const handleNavigationStateChange = async (navState: any) => {
    if (navState.url.includes('/d2l/home') && !loggedIn && !submitting) {
      if (__DEV__) console.log('[D2L WebView] At /d2l/home — injecting fetch script');
      setLoggedIn(true);
      setStatusText('Session captured! Fetching courses...');
      // Small delay to let page fully load before injecting
      setTimeout(() => {
        webViewRef.current?.injectJavaScript(buildFetchScript(host));
      }, 1000);
    }
  };

  const handleMessage = async (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      if (msg.type === 'error') {
        console.error('[D2L WebView] In-page fetch error:', msg.message);
        Alert.alert('Error', msg.message || 'Failed to fetch D2L data');
        setSubmitting(false);
        setStatusText('Please log in to D2L');
        setLoggedIn(false);
        return;
      }

      if (msg.type === 'courseData') {
        const { courseData } = msg;
        if (__DEV__) console.log(`[D2L WebView] Got data for ${courseData.length} courses`);

        setSubmitting(true);
        setStatusText('Saving to your account...');

        // We still need cookies to store — get them via CookieManager as before
        // but now we don't need them for the D2L fetch (WebView did that)
        // Just send courseData without cookies and let backend handle cookie-free storage
        // Actually we need cookies for auth on subsequent syncs — get them
        const CookieManager = require('@react-native-cookies/cookies').default;
        const cookies = await CookieManager.get(`https://${host}`, true);
        const d2lSessionVal = cookies.d2lSessionVal?.value;
        const d2lSecureSessionVal = cookies.d2lSecureSessionVal?.value;
        const cookieString = d2lSessionVal && d2lSecureSessionVal
          ? `d2lSessionVal=${d2lSessionVal}; d2lSecureSessionVal=${d2lSecureSessionVal}`
          : '';

        await apiClient.post('/d2l/connect-and-sync', {
          host,
          cookies: cookieString,
          courseData,
        });

        if (__DEV__) console.log('[D2L WebView] Connect and sync complete');
        navigation.goBack();
      }
    } catch (e) {
      console.error('[D2L WebView] handleMessage error:', e);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <AntDesign name="close" size={24} color="#1e293b" />
        </TouchableOpacity>
        <Text style={styles.title}>Sign in to D2L</Text>
        <View style={styles.placeholder} />
      </View>

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      )}

      <WebView
        ref={webViewRef}
        source={{ uri: d2lUrl }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={handleNavigationStateChange}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        sharedCookiesEnabled={true}
        onError={(e) => console.error('[D2L WebView] Error:', e.nativeEvent)}
        onHttpError={(e) => console.error('[D2L WebView] HTTP Error:', e.nativeEvent)}
      />

      <View style={styles.footer}>
        <View style={styles.tokenStatus}>
          {loggedIn ? (
            <AntDesign name="checkcircle" size={20} color="#10b981" />
          ) : (
            <AntDesign name="info" size={20} color="#6366f1" />
          )}
          <Text style={styles.tokenStatusText}>{statusText}</Text>
          {submitting && <ActivityIndicator size="small" color="#6366f1" style={{ marginLeft: 8 }} />}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  title: { fontSize: 18, fontWeight: '600', color: '#1e293b' },
  placeholder: { width: 32 },
  loadingContainer: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center', alignItems: 'center', zIndex: 1000,
  },
  loadingText: { marginTop: 12, fontSize: 16, color: '#64748b' },
  webview: { flex: 1 },
  footer: {
    padding: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0', backgroundColor: '#fff',
  },
  tokenStatus: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, backgroundColor: '#f1f5f9', borderRadius: 8,
  },
  tokenStatusText: { flex: 1, marginLeft: 8, fontSize: 14, color: '#475569' },
});
