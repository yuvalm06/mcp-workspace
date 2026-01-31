import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { authService } from '../../services/auth';

interface VerifyEmailRouteParams {
  email: string;
}

export default function VerifyEmailScreen() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const navigation = useNavigation();
  const route = useRoute();
  const { email } = (route.params as VerifyEmailRouteParams) || { email: '' };

  const handleVerify = async () => {
    if (!code.trim()) {
      Alert.alert('Error', 'Please enter the verification code');
      return;
    }

    if (code.length < 6) {
      Alert.alert('Error', 'Verification code must be 6 digits');
      return;
    }

    setLoading(true);
    try {
      await authService.confirmSignUp(email, code);
      Alert.alert(
        'Success',
        'Email verified! You can now sign in.',
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Login' as never),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Verification Failed', error.message || 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await authService.resendConfirmationCode(email);
      Alert.alert('Success', 'Verification code sent to your email');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify Email</Text>
      <Text style={styles.subtitle}>
        We sent a verification code to{'\n'}
        <Text style={styles.email}>{email}</Text>
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Enter 6-digit code"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
      />

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleVerify}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Verify</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.resendButton}
        onPress={handleResend}
        disabled={resending}
      >
        {resending ? (
          <ActivityIndicator size="small" color="#007AFF" />
        ) : (
          <Text style={styles.resendText}>Resend Code</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.linkButton}
        onPress={() => navigation.navigate('Login' as never)}
      >
        <Text style={styles.linkText}>Back to Sign In</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
    color: '#1e293b',
  },
  subtitle: {
    fontSize: 16,
    color: '#64748b',
    marginBottom: 40,
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '500',
  },
  email: {
    fontWeight: '600',
    color: '#6366f1',
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    fontSize: 28,
    textAlign: 'center',
    letterSpacing: 12,
    fontWeight: '700',
    backgroundColor: '#f8fafc',
    color: '#1e293b',
  },
  button: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
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
  resendButton: {
    marginTop: 20,
    alignItems: 'center',
    padding: 12,
  },
  resendText: {
    color: '#6366f1',
    fontSize: 14,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  linkText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '500',
  },
});
