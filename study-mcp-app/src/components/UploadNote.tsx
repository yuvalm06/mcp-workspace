import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { apiClient } from '../config/api';

const UploadNote = () => {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
    // New API: result.canceled + result.assets[]
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append('file', blob as any, asset.name);
      if (asset.name) formData.append('title', asset.name.replace(/\.pdf$/i, ''));

      await apiClient.post('/notes/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      Alert.alert('Uploaded!', `"${asset.name}" is being processed.`);
    } catch (error: any) {
      console.error('Upload error:', error);
      Alert.alert('Error', error.message || 'Failed to upload note');
    } finally {
      setUploading(false);
    }
  };

  return (
    <TouchableOpacity style={styles.button} onPress={handleUpload} disabled={uploading}>
      {uploading
        ? <ActivityIndicator size="small" color="#fff" />
        : <Text style={styles.text}>Upload Note</Text>
      }
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  text: { color: '#fff', fontWeight: '600', fontSize: 15 },
});

export default UploadNote;
