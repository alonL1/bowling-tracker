import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { queryClient } from '@/lib/query-client';
import { AuthProvider } from '@/providers/auth-provider';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="light" backgroundColor={palette.background} />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: {
                  backgroundColor: palette.background,
                },
              }}
            />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
