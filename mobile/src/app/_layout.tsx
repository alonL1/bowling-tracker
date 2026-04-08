import { Redirect, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

import CenteredState from '@/components/centered-state';
import GlobalAppNav from '@/components/global-app-nav';
import { palette } from '@/constants/palette';
import { queryClient, queryPersistOptions } from '@/lib/query-client';
import { AuthProvider } from '@/providers/auth-provider';
import { UploadsProcessingProvider } from '@/providers/uploads-processing-provider';
import { useAuth } from '@/providers/auth-provider';

function isProfileGuardExemptPath(pathname: string) {
  return (
    pathname === '/login' ||
    pathname === '/complete-profile' ||
    pathname === '/choose-avatar' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/delete-account' ||
    pathname === '/delete-data'
  );
}

function RootNavigator() {
  const pathname = usePathname();
  const { user, loading, isGuest, profileComplete, avatarStepNeeded } = useAuth();
  const nextPath = pathname || '/(tabs)/sessions';

  if (loading) {
    return <CenteredState title="Loading account..." loading />;
  }

  if (user && !isGuest) {
    if (!profileComplete && !isProfileGuardExemptPath(nextPath)) {
      return <Redirect href={`/complete-profile?next=${encodeURIComponent(nextPath)}`} />;
    }

    if (profileComplete && avatarStepNeeded && !isProfileGuardExemptPath(nextPath)) {
      return <Redirect href={`/choose-avatar?next=${encodeURIComponent(nextPath)}`} />;
    }

    if (!profileComplete && nextPath === '/choose-avatar') {
      return <Redirect href={`/complete-profile?next=${encodeURIComponent('/(tabs)/sessions')}`} />;
    }
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: palette.background,
        },
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={queryPersistOptions}>
          <AuthProvider>
            <UploadsProcessingProvider>
              <View style={{ flex: 1 }}>
                <StatusBar style="light" backgroundColor={palette.background} />
                <RootNavigator />
                <GlobalAppNav />
              </View>
            </UploadsProcessingProvider>
          </AuthProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
