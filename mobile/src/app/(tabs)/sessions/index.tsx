import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import CenteredState from '@/components/centered-state';
import InfoBanner from '@/components/info-banner';
import ScreenShell from '@/components/screen-shell';
import SessionCard from '@/components/session-card';
import SurfaceCard from '@/components/surface-card';
import { fetchGames, queryKeys } from '@/lib/backend';
import { buildSessionGroups } from '@/lib/bowling';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { useAuth } from '@/providers/auth-provider';

export default function SessionsScreen() {
  const router = useRouter();
  const { isGuest } = useAuth();
  const gamesQuery = useQuery({
    queryKey: queryKeys.games,
    queryFn: fetchGames,
  });

  const sessionGroups = useMemo(() => {
    return buildSessionGroups(gamesQuery.data?.games ?? []).groups;
  }, [gamesQuery.data?.games]);

  if (gamesQuery.isPending) {
    return <CenteredState title="Loading sessions..." loading />;
  }

  return (
    <ScreenShell
      title="Sessions"
      refreshControl={
        <RefreshControl
          refreshing={gamesQuery.isRefetching}
          onRefresh={() => void gamesQuery.refetch()}
          tintColor={palette.spinner}
        />
      }>
      {isGuest ? (
        <InfoBanner text="You are browsing in a guest session. Sign in to keep these logs on your account." />
      ) : null}

      {gamesQuery.error ? (
        <InfoBanner
          tone="error"
          text={gamesQuery.error instanceof Error ? gamesQuery.error.message : 'Failed to load sessions.'}
        />
      ) : null}

      <View style={styles.list}>
        {sessionGroups.length === 0 ? (
          <SurfaceCard style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No sessions yet</Text>
            <Text style={styles.emptyText}>
              Once you log games with the mobile or web app, they will show up here.
            </Text>
          </SurfaceCard>
        ) : (
          sessionGroups.map((session) => (
            <SessionCard
              key={session.key}
              session={session}
              onPress={() =>
                router.push({
                  pathname: '/sessions/[sessionId]',
                  params: { sessionId: session.key },
                })
              }
            />
          ))
        )}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  emptyCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: palette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  emptyText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
});
