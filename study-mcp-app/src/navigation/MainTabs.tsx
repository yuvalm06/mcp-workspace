import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AntDesign } from '@expo/vector-icons';
import HomeStack from './HomeStack';
import NotesUploadScreen from '../screens/NotesUploadScreen';
import IntegrationsScreen from '../screens/IntegrationsScreen';
import NotesScreen from '../screens/NotesScreen';
import PiazzaScreen from '../screens/PiazzaScreen';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();

const MainTabs = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: 4,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerShown: false,
        tabBarIcon: ({ color, size }) => {
          const icons: Record<string, string> = {
            Home: 'home',
            Notes: 'book',
            Upload: 'upload',
            Piazza: 'message1',
            Sync: 'setting',
          };
          return <AntDesign name={(icons[route.name] || 'appstore') as any} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeStack} />
      <Tab.Screen name="Notes" component={NotesScreen} />
      <Tab.Screen name="Upload" component={NotesUploadScreen} />
      <Tab.Screen name="Piazza" component={PiazzaScreen} />
      <Tab.Screen name="Sync" component={IntegrationsScreen} />
    </Tab.Navigator>
  );
};

export default MainTabs;
