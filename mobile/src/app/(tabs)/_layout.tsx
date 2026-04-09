import { Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import { Tabs } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import CenteredState from '@/components/centered-state';
import MobileTabBar from '@/components/mobile-tab-bar';
import SafeRedirect from '@/components/safe-redirect';
import { palette } from '@/constants/palette';
import { fetchGames, fetchLeaderboard, fetchRecordEntryStatus, queryKeys } from '@/lib/backend';
import { useAuth } from '@/providers/auth-provider';

export default function TabsLayout() {
  const { user, loading, isGuest } = useAuth();
  const queryClient = useQueryClient();
  const warmedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      warmedUserIdRef.current = null;
      return;
    }

    if (warmedUserIdRef.current === user.id) {
      return;
    }

    warmedUserIdRef.current = user.id;

    void Promise.allSettled([
      queryClient.prefetchQuery({
        queryKey: queryKeys.games,
        queryFn: fetchGames,
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.recordEntryStatus,
        queryFn: fetchRecordEntryStatus,
      }),
      Asset.loadAsync([
        require('../../../assets/pins/happy_pin.png'),
        require('../../../assets/pins/thinking_pin.png'),
        require('../../../assets/pins/idea_pin.png'),
      ]),
      ...(isGuest
        ? []
        : [
            queryClient.prefetchQuery({
              queryKey: queryKeys.leaderboard,
              queryFn: fetchLeaderboard,
            }),
          ]),
    ]);
  }, [isGuest, queryClient, user]);

  if (loading) {
    return <CenteredState title="Loading account..." loading />;
  }

  if (!user) {
    return <SafeRedirect href="/login" />;
  }

  return (
    <Tabs
      tabBar={(props) => <MobileTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        lazy: true,
        freezeOnBlur: true,
        sceneStyle: {
          backgroundColor: palette.background,
        },
      }}>
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="book-open-page-variant" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-ellipses" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="record"
        options={{
          title: 'Record',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
