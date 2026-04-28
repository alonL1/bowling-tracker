import { Stack, useGlobalSearchParams, usePathname, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

import AccountLoadingState from '@/components/account-loading-state';
import CenteredState from '@/components/centered-state';
import GlobalAppNav from '@/components/global-app-nav';
import SafeRedirect from '@/components/safe-redirect';
import { palette } from '@/constants/palette';
import { DEFAULT_POST_AUTH_PATH, getSafePostAuthPath } from '@/lib/onboarding';
import { queryClient, queryPersistOptions } from '@/lib/query-client';
import { AuthProvider } from '@/providers/auth-provider';
import { UploadsProcessingProvider } from '@/providers/uploads-processing-provider';
import { useAuth } from '@/providers/auth-provider';

function isSignedOutPublicPath(pathname: string) {
  return (
    pathname === '/welcome' ||
    pathname === '/login' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/delete-account' ||
    pathname === '/delete-data' ||
    pathname.startsWith('/invite/')
  );
}

function isProfileGuardExemptPath(pathname: string) {
  return (
    pathname === '/complete-profile' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/delete-account' ||
    pathname === '/delete-data'
  );
}

function isAvatarGuardExemptPath(pathname: string) {
  return (
    pathname === '/choose-avatar' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/delete-account' ||
    pathname === '/delete-data'
  );
}

function isTutorialGuardExemptPath(pathname: string) {
  return (
    pathname === '/complete-profile' ||
    pathname === '/choose-avatar' ||
    pathname === '/getting-started' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/delete-account' ||
    pathname === '/delete-data'
  );
}

function usesDefaultPostAuthFallback(pathname: string) {
  return (
    pathname === '/' ||
    pathname === '/welcome' ||
    pathname === '/login' ||
    pathname === '/complete-profile' ||
    pathname === '/choose-avatar' ||
    pathname === '/getting-started'
  );
}

function isAuthEntryPath(pathname: string) {
  return pathname === '/welcome' || pathname === '/';
}

function RootNavigator() {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ next?: string; replay?: string; preview?: string }>();
  const { user, loading, isGuest, profileUnavailable, profileComplete, avatarStepNeeded, tutorialSeen } = useAuth();
  const currentPath = pathname || DEFAULT_POST_AUTH_PATH;
  const nextPath = getSafePostAuthPath(
    params.next,
    usesDefaultPostAuthFallback(currentPath) ? DEFAULT_POST_AUTH_PATH : currentPath,
  );
  const replayTutorial = params.replay === '1';
  const tutorialPreview = currentPath === '/getting-started' && params.preview === '1';

  if (loading) {
    return <AccountLoadingState />;
  }

  if (user && !isGuest && profileUnavailable) {
    return (
      <CenteredState
        title="Can't load your account"
        subtitle="Check your connection and reopen PinPoint. Your saved account state could not be loaded while offline."
      />
    );
  }

  if (!user && !tutorialPreview && !isSignedOutPublicPath(currentPath)) {
    return <SafeRedirect href={`/welcome?next=${encodeURIComponent(nextPath)}`} />;
  }

  if (!user) {
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

  if (isGuest) {
    if (currentPath === '/complete-profile' || currentPath === '/choose-avatar') {
      return <SafeRedirect href={nextPath as Href} />;
    }

    if (!tutorialSeen && currentPath !== '/welcome' && currentPath !== '/login' && !isTutorialGuardExemptPath(currentPath)) {
      return <SafeRedirect href={`/getting-started?next=${encodeURIComponent(nextPath)}`} />;
    }

    if (currentPath === '/getting-started' && tutorialSeen && !replayTutorial) {
      return <SafeRedirect href={nextPath as Href} />;
    }

    if (currentPath === '/') {
      return <SafeRedirect href={nextPath as Href} />;
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

  if (!profileComplete) {
    if (!isProfileGuardExemptPath(currentPath)) {
      return <SafeRedirect href={`/complete-profile?next=${encodeURIComponent(nextPath)}`} />;
    }
  } else if (currentPath === '/complete-profile') {
    if (avatarStepNeeded) {
      return <SafeRedirect href={`/choose-avatar?next=${encodeURIComponent(nextPath)}`} />;
    }

    if (!tutorialSeen) {
      return <SafeRedirect href={`/getting-started?next=${encodeURIComponent(nextPath)}`} />;
    }

    return <SafeRedirect href={nextPath as Href} />;
  }

  if (profileComplete && avatarStepNeeded) {
    if (!isAvatarGuardExemptPath(currentPath)) {
      return <SafeRedirect href={`/choose-avatar?next=${encodeURIComponent(nextPath)}`} />;
    }
  } else if (currentPath === '/choose-avatar') {
    if (!avatarStepNeeded && !tutorialSeen) {
      return <SafeRedirect href={`/getting-started?next=${encodeURIComponent(nextPath)}`} />;
    }

    return <SafeRedirect href={nextPath as Href} />;
  }

  if (profileComplete && !avatarStepNeeded && !tutorialSeen && !isTutorialGuardExemptPath(currentPath)) {
    return <SafeRedirect href={`/getting-started?next=${encodeURIComponent(nextPath)}`} />;
  }

  if (
    currentPath === '/getting-started' &&
    profileComplete &&
    !avatarStepNeeded &&
    tutorialSeen &&
    !replayTutorial
  ) {
    return <SafeRedirect href={nextPath as Href} />;
  }

  if (isAuthEntryPath(currentPath)) {
    return <SafeRedirect href={nextPath as Href} />;
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
