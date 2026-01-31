import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
  FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AntDesign } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../lib/supabase';
import { d2lService } from '../services/d2l';

interface Course {
  id: string;
  name: string;
  code: string;
}

export default function NotesUploadScreen() {
  const [file, setFile] = useState<DocumentPicker.DocumentPickerResult | null>(null);
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState('');
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [showCoursePicker, setShowCoursePicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const navigation = useNavigation();

  const loadCourses = async () => {
    try {
      setLoadingCourses(true);
      const data = await d2lService.getCourses();
      setCourses(data);
    } catch (error: any) {
      // Don't show error - courses are optional
    } finally {
      setLoadingCourses(false);
    }
  };

  useEffect(() => {
    loadCourses();
  }, []);

  const selectCourse = (course: Course) => {
    setSelectedCourse(course);
    setCourseId(course.id);
    setShowCoursePicker(false);
  };

  const pickDocument = async () => {
    try {
      const permissionResult = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (permissionResult.canceled) return;
      if (permissionResult.assets && permissionResult.assets[0]) {
        const asset = permissionResult.assets[0];
        if (!asset.uri) {
          Alert.alert('Error', 'Invalid file selected');
          return;
        }
        setFile(permissionResult);
        if (!title) {
          setTitle(asset.name.replace('.pdf', ''));
        }
      } else {
        Alert.alert('Error', 'No file selected');
      }
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to pick document');
    }
  };

  const handleUpload = async () => {
    if (!file || file.canceled || !file.assets || !file.assets[0]) {
      Alert.alert('Error', 'Please select a file');
      return;
    }
    const asset = file.assets[0];
    if (!asset.uri) {
      Alert.alert('Error', 'Invalid file');
      return;
    }

    setError(null);
    setUploading(true);
    setUploadProgress(0);

    try {
      setUploadProgress(10);

      // 1. Prepare file for upload
      const fileName = `${Date.now()}-${asset.name}`;
      const filePath = `notes/${fileName}`;

      // We need to fetch the file to get a blob for Supabase upload in React Native
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      setUploadProgress(30);

      // 2. Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('notes')
        .upload(filePath, blob, {
          contentType: asset.mimeType || 'application/pdf',
          upsert: false
        });

      if (uploadError) throw uploadError;

      setUploadProgress(60);
      setUploading(false);
      setProcessing(true);
      setUploadProgress(80);

      // 3. Save metadata to notes table
      const { data: noteData, error: dbError } = await supabase
        .from('notes')
        .insert([
          {
            title: title || asset.name.replace('.pdf', ''),
            course_id: courseId || null,
            file_path: filePath,
            user_id: (await supabase.auth.getUser()).data.user?.id,
            mime_type: asset.mimeType || 'application/pdf',
            size: asset.size || 0,
          }
        ])
        .select();

      if (dbError) throw dbError;

      // 4. Trigger processing (Edge Function)
      await supabase.functions.invoke('study-logic', {
        body: {
          action: 'process_note',
          noteId: noteData[0].id,
          filePath: filePath
        }
      });

      setUploadProgress(100);
      Alert.alert(
        'Success',
        'Note uploaded and metadata saved successfully!',
        [
          {
            text: 'OK',
            onPress: () => {
              setFile(null);
              setTitle('');
              setCourseId('');
              setSelectedCourse(null);
              setProcessing(false);
              setUploadProgress(0);
              navigation.goBack();
            },
          },
        ]
      );
    } catch (error: any) {
      console.error('Upload error:', error);
      const errorMessage = error.message || 'An error occurred during upload';
      setError(errorMessage);
      Alert.alert('Upload Error', errorMessage);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Upload Notes</Text>
      <TouchableOpacity style={styles.input} onPress={() => setShowCoursePicker(true)}>
        <Text style={styles.inputText}>{selectedCourse ? selectedCourse.name : 'Select Course'}</Text>
        <AntDesign name="down" size={16} color="#64748b" style={{ marginLeft: 8 }} />
      </TouchableOpacity>
      <Modal visible={showCoursePicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Course</Text>
            {loadingCourses ? (
              <ActivityIndicator size="large" color="#6366f1" />
            ) : (
              <FlatList
                data={courses}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.courseItem} onPress={() => selectCourse(item)}>
                    <Text style={styles.courseName}>{item.name}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowCoursePicker(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <TouchableOpacity style={styles.input} onPress={pickDocument}>
        <Text style={styles.inputText}>{file && file.assets && file.assets[0] ? file.assets[0].name : 'Select PDF File'}</Text>
        <AntDesign name="paperclip" size={16} color="#64748b" style={{ marginLeft: 8 }} />
      </TouchableOpacity>
      <TextInput
        style={styles.textInput}
        placeholder="Title (optional)"
        value={title}
        onChangeText={setTitle}
      />
      {uploading || processing ? (
        <View style={styles.progressContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.progressText}>{processing ? 'Processing...' : 'Uploading...'} {uploadProgress}%</Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.uploadButton} onPress={handleUpload}>
          <AntDesign name="upload" size={18} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.uploadButtonText}>Upload</Text>
        </TouchableOpacity>
      )}
      {error && <Text style={styles.errorText}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f8fafc',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 24,
    color: '#1e293b',
  },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
    width: '100%',
  },
  inputText: {
    flex: 1,
    fontSize: 16,
    color: '#1e293b',
  },
  textInput: {
    width: '100%',
    fontSize: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
    color: '#1e293b',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 16,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  uploadButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  progressText: {
    marginLeft: 12,
    fontSize: 16,
    color: '#6366f1',
    fontWeight: '600',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '80%',
    maxHeight: '70%',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    color: '#1e293b',
  },
  courseItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    width: '100%',
  },
  courseName: {
    fontSize: 16,
    color: '#1e293b',
  },
  closeButton: {
    marginTop: 16,
    backgroundColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  closeButtonText: {
    color: '#1e293b',
    fontWeight: '600',
    fontSize: 16,
  },
});