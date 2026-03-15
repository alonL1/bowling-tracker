import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import CenteredState from '@/components/centered-state';
import DetailShell from '@/components/detail-shell';
import { acceptInvite, lookupInvite, queryKeys } from '@/lib/backend';
import { palette, spacing } from '@/constants/palette';
import { useAuth } from '@/providers/auth-provider';

export default function InviteScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { loading: authLoading, isGuest } = useAuth();
  const [acceptMessage, setAcceptMessage] = useState('');
  const [acceptError, setAcceptError] = useState('');

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (isGuest) {
      router.replace(`/login?next=/invite/${token}`);
    }
  }, [authLoading, isGuest, router, token]);

  const inviteQuery = useQuery({
    queryKey: queryKeys.inviteLookup(token),
    queryFn: () => lookupInvite(token),
    enabled: Boolean(token) && !authLoading && !isGuest,
  });

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

  if (authLoading || inviteQuery.isPending) {
    return <CenteredState title="Loading invite..." loading />;
  }

  return (
    <DetailShell
      title="Friend Invite"
      subtitle="Accept the invite to add this bowler to your friends leaderboard.">
      <View style={styles.card}>
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

        {inviteQuery.data?.canAccept ? (
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

        <Pressable onPress={() => router.replace('/(tabs)/friends')} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Text style={styles.secondaryButtonText}>Go to Friends</Text>
        </Pressable>
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
