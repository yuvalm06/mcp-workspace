import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeStack from './HomeStack';
import NotesUploadScreen from '../screens/NotesUploadScreen';
import IntegrationsScreen from '../screens/IntegrationsScreen';

const Tab = createBottomTabNavigator();

const MainTabs = () => {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeStack} />
      <Tab.Screen name="Upload" component={NotesUploadScreen} />
      <Tab.Screen name="Sync" component={IntegrationsScreen} />
    </Tab.Navigator>
  );
};

export default MainTabs;