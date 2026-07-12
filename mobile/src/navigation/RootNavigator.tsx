import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './navRef';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAppDispatch, useAppSelector } from '@store/index';
import { restoreSession } from '@store/authSlice';
import { useSocket } from '@hooks/useSocket';

import { OnboardingScreen } from '@screens/OnboardingScreen';
import { RegisterScreen } from '@screens/RegisterScreen';
import { LoginScreen } from '@screens/LoginScreen';
import { HomeScreen } from '@screens/HomeScreen';
import { ChatScreen } from '@screens/ChatScreen';
import { CallScreen } from '@screens/CallScreen';
import { VideoCallScreen } from '@screens/VideoCallScreen';
import { ContactsScreen } from '@screens/ContactsScreen';
import { ProfileScreen } from '@screens/ProfileScreen';
import { SettingsScreen } from '@screens/SettingsScreen';
import { ShieldScreen } from '@screens/ShieldScreen';
import { ShieldLogScreen } from '@screens/ShieldLogScreen';
import { ShieldSettingsScreen } from '@screens/ShieldSettingsScreen';
import { ShieldTroubleshootScreen } from '@screens/ShieldTroubleshootScreen';
import { StoryViewerScreen } from '@screens/StoryViewerScreen';
import { StoryCreateScreen } from '@screens/StoryCreateScreen';
import { GroupCreateScreen } from '@screens/GroupCreateScreen';
import { GroupInviteScreen } from '@screens/GroupInviteScreen';
import { GroupInfoScreen } from '@screens/GroupInfoScreen';
import { QRPairingScreen } from '@screens/QRPairingScreen';
import { SafetyNumberScreen } from '@screens/SafetyNumberScreen';
import { theme } from '@utils/theme';
import { HomeIcon, ContactsIcon, ShieldIcon, SettingsIcon } from '@components/Icons';

const Stack = createStackNavigator();
const Tabs = createBottomTabNavigator();

const navTheme: any = {
  dark: true,
  colors: { primary: theme.accent, background: theme.bg, card: theme.bg, text: theme.text, border: theme.border, notification: theme.alert },
};

const tabIcon = (Icon: React.FC<{ size?: number; color?: string; strokeWidth?: number }>) =>
  ({ color, focused }: { color: string; focused: boolean }) =>
    <Icon size={24} color={color} strokeWidth={focused ? 2.4 : 1.8} />;

const MainTabs = () => (
  <Tabs.Navigator screenOptions={{
    headerShown: false,
    tabBarStyle: {
      backgroundColor: theme.bgElev,
      borderTopColor: theme.border,
      borderTopWidth: 1,
      height: 64,
      paddingBottom: 8,
      paddingTop: 8,
    },
    tabBarActiveTintColor: theme.accent,
    tabBarInactiveTintColor: theme.textDim,
    tabBarLabelStyle: { fontSize: 10, letterSpacing: 1.5, fontWeight: '700', textTransform: 'uppercase' },
  }}>
    <Tabs.Screen name="Home"     component={HomeScreen}     options={{ tabBarIcon: tabIcon(HomeIcon) }} />
    <Tabs.Screen name="Contacts" component={ContactsScreen} options={{ tabBarIcon: tabIcon(ContactsIcon) }} />
    <Tabs.Screen name="Shield"   component={ShieldScreen}   options={{ tabBarIcon: tabIcon(ShieldIcon) }} />
    <Tabs.Screen name="Settings" component={SettingsScreen} options={{ tabBarIcon: tabIcon(SettingsIcon) }} />
  </Tabs.Navigator>
);

export const RootNavigator: React.FC = () => {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const bootstrapping = useAppSelector((s) => s.auth.bootstrapping);

  useEffect(() => { dispatch(restoreSession()); }, [dispatch]);
  useSocket();

  if (bootstrapping) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, cardStyle: { backgroundColor: theme.bg } }}>
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Call" component={CallScreen} options={{ presentation: 'modal' as any }} />
            <Stack.Screen name="VideoCall" component={VideoCallScreen} options={{ presentation: 'modal' as any }} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="ShieldLog" component={ShieldLogScreen} />
            <Stack.Screen name="ShieldSettings" component={ShieldSettingsScreen} />
            <Stack.Screen name="ShieldTroubleshoot" component={ShieldTroubleshootScreen} />
            <Stack.Screen name="StoryViewer" component={StoryViewerScreen} options={{ presentation: 'modal' as any }} />
            <Stack.Screen name="StoryCreate" component={StoryCreateScreen} options={{ presentation: 'modal' as any }} />
            <Stack.Screen name="GroupCreate" component={GroupCreateScreen} />
            <Stack.Screen name="GroupInvite" component={GroupInviteScreen} />
            <Stack.Screen name="GroupInfo" component={GroupInfoScreen} />
            <Stack.Screen name="SafetyNumber" component={SafetyNumberScreen} />
            <Stack.Screen name="QRPairing" component={QRPairingScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
