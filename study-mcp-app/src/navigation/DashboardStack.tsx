import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MainTabs from './AppNavigator';
import UploadScreen from '../screens/UploadScreen';
import CourseDetailScreen from '../screens/CourseDetailScreen';
import { AntDesign } from '@expo/vector-icons';

const Stack = createNativeStackNavigator();

export default function DashboardStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: '#6366f1',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <Stack.Screen
        name="MainTabs"
        component={MainTabs}
        options={{
          headerTitle: 'Dashboard',
          headerLeft: () => (
            <AntDesign name="menu" size={24} color="#fff" style={{ marginLeft: 16 }} />
          ),
        }}
      />
      <Stack.Screen
        name="Upload"
        component={UploadScreen}
        options={{
          headerTitle: 'Upload Note',
        }}
      />
      <Stack.Screen
        name="CourseDetail"
        component={CourseDetailScreen}
        options={{
          headerTitle: 'Course Details',
        }}
      />
    </Stack.Navigator>
  );
}