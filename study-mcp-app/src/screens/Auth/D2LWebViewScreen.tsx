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
import { d2lService } from '../../services/d2l';

interface D2LWebViewScreenProps {
  route: {
    params: {
      host: string;
      username?: string;
      password?: string;
    };
  };
}

export default function D2LWebViewScreen({ route }: D2LWebViewScreenProps) {
  const { host, username, password } = route.params;
  const navigation = useNavigation();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [capturedToken, setCapturedToken] = useState<string | null>(null);
  const [capturedCookies, setCapturedCookies] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const d2lUrl = `https://${host}/d2l/home`;

  // Simple injection: just intercept requests and check cookies periodically
  const injectedJavaScript = `
    (function() {
      if (window.d2lInjected) return;
      window.d2lInjected = true;

      let tokenCaptured = false;
      
      function sendToken(token) {
        if (!tokenCaptured && token && token.length > 20) {
          tokenCaptured = true;
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'TOKEN_CAPTURED',
            token: token
          }));
        }
      }

      function sendCookies(cookies) {
        if (!tokenCaptured && cookies) {
          tokenCaptured = true;
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'COOKIES_CAPTURED',
            cookies: cookies
          }));
        }
      }

      // Simple fetch interception
      const originalFetch = window.fetch;
      window.fetch = function(...args) {
        const url = args[0];
        const options = args[1] || {};
        if (typeof url === 'string' && url.includes('/d2l/api/')) {
          const headers = options.headers || {};
          const auth = headers['Authorization'] || headers['authorization'];
          if (auth && auth.startsWith('Bearer ')) {
            sendToken(auth.substring(7));
          }
        }
        return originalFetch.apply(this, args);
      };

      // Simple XHR interception
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
      const originalSend = XMLHttpRequest.prototype.send;
      
      XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        this._headers = {};
        return originalOpen.apply(this, arguments);
      };
      
      XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        this._headers[header.toLowerCase()] = value;
        if (this._url && this._url.includes('/d2l/api/') && header.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) {
          sendToken(value.substring(7));
        }
        return originalSetHeader.apply(this, arguments);
      };
      
      XMLHttpRequest.prototype.send = function() {
        if (this._url && this._url.includes('/d2l/api/')) {
          const auth = this._headers['authorization'];
          if (auth && auth.startsWith('Bearer ')) {
            sendToken(auth.substring(7));
          }
        }
        return originalSend.apply(this, arguments);
      };

      // Auto-login
      const NOTE_USER = ${JSON.stringify(username || '')};
      const NOTE_PASS = ${JSON.stringify(password || '')};
      
      if (NOTE_USER && NOTE_PASS) {
        const isLoginPage = window.location.href.includes('login') || 
                           window.location.href.includes('microsoftonline') || 
                           window.location.href.includes('sso') || 
                           window.location.href.includes('adfs');
        
        if (isLoginPage) {
          setTimeout(function() {
            // Find username
            const usernameField = document.querySelector('input#userNameInput') || 
                                 document.querySelector('input[name="UserName"]') ||
                                 document.querySelector('input[type="email"]') ||
                                 document.querySelector('input[name="username"]');
            
            if (usernameField) {
              usernameField.value = NOTE_USER;
              usernameField.dispatchEvent(new Event('input', { bubbles: true }));
              
              setTimeout(function() {
                // Click Next or press Enter
                const nextBtn = document.querySelector('input[type="submit"]') || 
                               document.querySelector('button[type="submit"]');
                if (nextBtn) {
                  nextBtn.click();
                } else {
                  usernameField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                }
                
                setTimeout(function() {
                  // Find password
                  const passwordField = document.querySelector('input#passwordInput') || 
                                       document.querySelector('input[name="Password"]') ||
                                       document.querySelector('input[type="password"]');
                  
                  if (passwordField) {
                    passwordField.value = NOTE_PASS;
                    passwordField.dispatchEvent(new Event('input', { bubbles: true }));
                    
                    setTimeout(function() {
                      // Submit
                      const submitBtn = document.querySelector('input[type="submit"]') || 
                                       document.querySelector('button[type="submit"]');
                      if (submitBtn) {
                        submitBtn.click();
                      } else {
                        passwordField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                      }
                    }, 500);
                  }
                }, 2000);
              }, 500);
            }
          }, 1000);
        }
      }

      // Check cookies immediately and then every 2 seconds
      function checkCookies() {
        if (tokenCaptured) {
          console.log('[COOKIE CHECK] Token already captured, skipping');
          return false;
        }
        try {
          const cookies = document.cookie;
          console.log('[COOKIE CHECK] Checking cookies, length:', cookies ? cookies.length : 0);
          console.log('[COOKIE CHECK] All cookies:', cookies);
          
          if (cookies && (cookies.includes('d2lSessionVal') || cookies.includes('d2lSecureSessionVal'))) {
            const sessionVal = cookies.match(/d2lSessionVal=([^;]+)/)?.[1];
            const secureSessionVal = cookies.match(/d2lSecureSessionVal=([^;]+)/)?.[1];
            console.log('[COOKIE CHECK] Found - sessionVal:', sessionVal ? 'YES' : 'NO', 'secureSessionVal:', secureSessionVal ? 'YES' : 'NO');
            
            if (sessionVal || secureSessionVal) {
              let cookieString = '';
              if (sessionVal) cookieString += 'd2lSessionVal=' + sessionVal;
              if (secureSessionVal) {
                if (cookieString) cookieString += '; ';
                cookieString += 'd2lSecureSessionVal=' + secureSessionVal;
              }
              console.log('[COOKIE CHECK] Sending cookies!');
              sendCookies(cookieString);
              return true;
            }
          } else {
            console.log('[COOKIE CHECK] No D2L cookies found');
          }
        } catch (e) {
          console.error('[COOKIE CHECK] Error:', e);
        }
        return false;
      }

      console.log('[INJECT] Script loaded, starting cookie checks...');
      
      // Check immediately
      setTimeout(function() {
        console.log('[COOKIE CHECK] Initial check...');
        checkCookies();
      }, 1000);

      // Check every 2 seconds
      let checkCount = 0;
      const cookieCheck = setInterval(function() {
        checkCount++;
        console.log('[COOKIE CHECK] Interval check #' + checkCount);
        
        if (tokenCaptured) {
          console.log('[COOKIE CHECK] Token captured, stopping');
          clearInterval(cookieCheck);
          return;
        }
        
        if (checkCount > 60) {
          console.log('[COOKIE CHECK] Max checks reached, final check...');
          clearInterval(cookieCheck);
          checkCookies();
          return;
        }
        
        checkCookies();
      }, 2000);
    })();
    true;
  `;

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('[D2L WebView] Message received:', data.type);

      if (data.type === 'TOKEN_CAPTURED' && data.token) {
        console.log('[D2L WebView] TOKEN CAPTURED!');
        setCapturedToken(data.token);
        if (!submitting) {
          setTimeout(() => handleSubmit(), 500);
        }
      } else if (data.type === 'COOKIES_CAPTURED' && data.cookies) {
        console.log('[D2L WebView] COOKIES CAPTURED!', data.cookies.substring(0, 50));
        setCapturedCookies(data.cookies);
        if (!submitting) {
          setTimeout(() => handleSubmit(), 500);
        }
      }
    } catch (e) {
      console.error('[D2L WebView] Error parsing message:', e);
    }
  };

  const handleSubmit = async () => {
    if (!capturedToken && !capturedCookies) {
      Alert.alert('No Credentials', 'Please log in first.');
      return;
    }

    setSubmitting(true);
    try {
      if (capturedCookies) {
        await d2lService.connectWithCookies({ host, cookies: capturedCookies });
      } else {
        await d2lService.connectWithToken({ host, token: capturedToken || "" });
      }

      Alert.alert('Success', 'D2L connected!', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to connect');
      setSubmitting(false);
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
        onMessage={handleMessage}
        injectedJavaScript={injectedJavaScript}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />

      <View style={styles.footer}>
        {capturedToken || capturedCookies ? (
          <View style={styles.tokenStatus}>
            <AntDesign name="checkcircle" size={20} color="#10b981" />
            <Text style={styles.tokenStatusText}>Credentials captured!</Text>
          </View>
        ) : (
          <View style={styles.tokenStatus}>
            <AntDesign name="infocircle" size={20} color="#6366f1" />
            <Text style={styles.tokenStatusText}>
              {username && password ? 'Auto-login in progress...' : 'Please log in to D2L'}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.connectButton, (!capturedToken && !capturedCookies || submitting) && styles.connectButtonDisabled]}
          onPress={handleSubmit}
          disabled={(!capturedToken && !capturedCookies) || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <AntDesign name="link" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.connectButtonText}>Connect</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
  },
  placeholder: {
    width: 32,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#64748b',
  },
  webview: {
    flex: 1,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  tokenStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
  },
  tokenStatusText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: '#475569',
  },
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  connectButtonDisabled: {
    backgroundColor: '#cbd5e1',
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
