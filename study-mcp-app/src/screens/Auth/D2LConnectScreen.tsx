import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { AntDesign } from '@expo/vector-icons';
import { d2lService } from '../../services/d2l';

export default function D2LConnectScreen() {
  const [host, setHost] = useState('learn.uwaterloo.ca');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'webview' | 'manual'>('webview');
  const navigation = useNavigation<any>();

  const handleWebViewConnect = () => {
    if (!host) {
      Alert.alert('Error', 'Please enter your D2L host');
      return;
    }
    // Navigate to WebView login screen with optional credentials
    navigation.navigate('D2LWebView', { host, username, password });
  };

  const handleManualConnect = async () => {
    if (!host || !username || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      await d2lService.connect({ host, username, password });

      Alert.alert(
        'Success',
        'Connected to D2L successfully!',
        [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Connection Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        <View style={styles.header}>
          <Text style={styles.title}>Connect to D2L</Text>
          <Text style={styles.subtitle}>
            Enter your D2L Brightspace credentials to sync courses, assignments, and grades.
          </Text>
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, mode === 'webview' && styles.activeTab]}
            onPress={() => setMode('webview')}
          >
            <Text style={[styles.tabText, mode === 'webview' && styles.activeTabText]}>Browser Login</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === 'manual' && styles.activeTab]}
            onPress={() => setMode('manual')}
          >
            <Text style={[styles.tabText, mode === 'manual' && styles.activeTabText]}>Manual Credentials</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>D2L Host</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., learn.uwaterloo.ca"
              value={host}
              onChangeText={setHost}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.helpText}>Your institution's D2L Brightspace URL</Text>
          </View>

          {mode === 'webview' ? (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Username (Optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="For auto-login"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password (Optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="For auto-login"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.infoBox}>
                <Text style={styles.infoTitle}>🔐 Secure Login</Text>
                <Text style={styles.infoText}>
                  You'll be redirected to sign in to D2L.
                  If you provide credentials above, the app will attempt to log you in automatically.
                </Text>
              </View>

              <TouchableOpacity
                style={styles.button}
                onPress={handleWebViewConnect}
              >
                <AntDesign name="link" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.buttonText}>Open Browser & Login</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Username</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Username"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleManualConnect}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <AntDesign name="login" size={18} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.buttonText}>Connect via API</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#64748b',
    lineHeight: 22,
  },
  tabContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#6366f1',
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#94a3b8',
  },
  activeTabText: {
    color: '#6366f1',
  },
  form: {
    padding: 24,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: '#ffffff',
    color: '#1e293b',
  },
  helpText: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 6,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 18,
    marginTop: 8,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  infoBox: {
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
  },
});
