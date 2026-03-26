import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import CenteredState from '@/components/centered-state';
import DetailShell from '@/components/detail-shell';
import { acceptInvite, lookupInvite, queryKeys } from '@/lib/backend';
import { palette, spacing } from '@/constants/palette';
import { useAuth } from '@/providers/auth-provider';

function getAppInviteUrl(token: string) {
  const scheme =
    typeof Constants.expoConfig?.scheme === 'string' && Constants.expoConfig.scheme.trim()
      ? Constants.expoConfig.scheme.trim()
      : typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? 'pinpoint-dev'
        : 'pinpoint';
  return `${scheme}:///invite/${token}`;
}

export default function InviteScreen() {
  const router = useRouter();
  const { token, browser } = useLocalSearchParams<{ token: string; browser?: string }>();
  const { loading: authLoading, isGuest } = useAuth();
  const [acceptMessage, setAcceptMessage] = useState('');
  const [acceptError, setAcceptError] = useState('');
  const [showOpenInAppHint, setShowOpenInAppHint] = useState(false);
  const [browserModeOverride, setBrowserModeOverride] = useState(false);
  const isWeb = Platform.OS === 'web';
  const appInviteUrl = token ? getAppInviteUrl(token) : '';
  const browserMode = isWeb && (browser === '1' || browserModeOverride);

  useEffect(() => {
    if (authLoading || isWeb) {
      return;
    }
    if (isGuest) {
      router.replace(`/login?next=/invite/${token}`);
    }
  }, [authLoading, isGuest, isWeb, router, token]);

  useEffect(() => {
    if (!isWeb || !token || !appInviteUrl || browserMode) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowOpenInAppHint(true);
    }, 1400);

    window.location.assign(appInviteUrl);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [appInviteUrl, browserMode, isWeb, token]);

  const enableBrowserMode = () => {
    if (!isWeb || !token) {
      return;
    }

    setBrowserModeOverride(true);
    setShowOpenInAppHint(true);
    router.replace(`/invite/${encodeURIComponent(token)}?browser=1`);
  };

  const inviteQuery = useQuery({
    queryKey: queryKeys.inviteLookup(token),
    queryFn: () => lookupInvite(token),
    enabled: Boolean(token) && !authLoading && (isWeb || !isGuest),
  });
  const canGoToFriends =
    (!isWeb || browserMode) && (Boolean(acceptMessage) || Boolean(inviteQuery.data?.alreadyFriends));

  const acceptMutation = useMutation({
    mutationFn: () => acceptInvite(token),
    onSuccess: (payload) => {
      setAcceptError('');
      setAcceptMessage(payload.alreadyFriends ? 'You are already friends.' : 'You are now friends.');
    },
    onError: (error) => {
      setAcceptError(error instanceof Error ? error.message : 'Failed to accept invite.');
    },
  });

  if ((!isWeb && authLoading) || (!isWeb && inviteQuery.isPending)) {
    return <CenteredState title="Loading invite..." loading />;
  }

  return (
    <DetailShell
      title="Friend Invite"
      subtitle="Accept the invite to add this bowler to your friends leaderboard.">
      <View style={styles.card}>
        {isWeb ? (
          <View style={styles.openInAppPanel}>
            <Text style={styles.bodyText}>
              {browserMode
                ? 'Continue below in your browser or open PinPoint instead.'
                : showOpenInAppHint
                  ? 'If the app did not open automatically, use one of the buttons below.'
                  : 'Opening invite in PinPoint...'}
            </Text>
            <View style={styles.browserActionGroup}>
              <Pressable
                onPress={() => {
                  if (!appInviteUrl || typeof window === 'undefined') {
                    return;
                  }
                  window.location.assign(appInviteUrl);
                }}
                style={({ pressed }) => [styles.primaryButton, styles.browserActionButton, pressed && styles.pressed]}>
                <Text style={styles.primaryButtonText}>Open in PinPoint</Text>
              </Pressable>
              <Pressable
                onPress={enableBrowserMode}
                style={({ pressed }) => [styles.secondaryButton, styles.browserActionButton, pressed && styles.pressed]}>
                <Text style={styles.secondaryButtonText}>Continue in Browser</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {isWeb && inviteQuery.data?.authRequired ? (
          browserMode ? (
            <View style={styles.browserAuthPanel}>
              <Text style={styles.bodyText}>Sign in in the browser to accept this invite.</Text>
              <Pressable
                onPress={() =>
                  router.push(`/login?next=${encodeURIComponent(`/invite/${token}?browser=1`)}`)
                }
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                <Text style={styles.primaryButtonText}>Sign In</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.bodyText}>Sign in in the PinPoint app to accept this invite.</Text>
          )
        ) : null}

        {inviteQuery.error ? (
          <Text style={styles.errorText}>
            {inviteQuery.error instanceof Error ? inviteQuery.error.message : 'Failed to load invite.'}
          </Text>
        ) : null}

        {inviteQuery.data?.inviter ? (
          <Text style={styles.bodyText}>
            <Text style={styles.emphasis}>{inviteQuery.data.inviter.displayName}</Text> invited you
            to connect.
          </Text>
        ) : null}

        {inviteQuery.data?.selfInvite ? (
          <Text style={styles.bodyText}>You cannot accept your own invite link.</Text>
        ) : null}

        {inviteQuery.data?.alreadyFriends ? (
          <Text style={styles.bodyText}>You are already friends.</Text>
        ) : null}

        {((!isWeb || browserMode) && inviteQuery.data?.canAccept) ? (
          <Pressable
            onPress={() => acceptMutation.mutate()}
            disabled={acceptMutation.isPending}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>
              {acceptMutation.isPending ? 'Accepting...' : 'Accept friend request'}
            </Text>
          </Pressable>
        ) : null}

        {acceptMessage ? <Text style={styles.bodyText}>{acceptMessage}</Text> : null}
        {acceptError ? <Text style={styles.errorText}>{acceptError}</Text> : null}

        {canGoToFriends ? (
          <Pressable onPress={() => router.replace('/(tabs)/friends')} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>Go to Friends</Text>
          </Pressable>
        ) : null}
      </View>
    </DetailShell>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  openInAppPanel: {
    gap: spacing.sm,
  },
  browserActionGroup: {
    gap: spacing.sm,
  },
  browserActionButton: {
    width: '100%',
  },
  browserAuthPanel: {
    gap: spacing.sm,
  },
  bodyText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
  },
  emphasis: {
    color: palette.text,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: palette.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: palette.background,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
  },
  errorText: {
    color: '#ff9ca7',
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.9,
  },
});
