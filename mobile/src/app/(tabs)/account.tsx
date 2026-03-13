import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import ActionButton from '@/components/action-button';
import InfoBanner from '@/components/info-banner';
import ScreenShell from '@/components/screen-shell';
import SurfaceCard from '@/components/surface-card';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { useAuth } from '@/providers/auth-provider';

export default function AccountScreen() {
  const router = useRouter();
  const { user, isGuest, signOutToGuestSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSignOut = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await signOutToGuestSession();
      router.replace('/(tabs)/sessions');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to sign out.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell
      title="Account"
      subtitle={
        isGuest
          ? 'Use a guest session now, or sign in to keep your logs across devices.'
          : 'This mobile app is connected to the same Bowling Tracker account as the web app.'
      }>
      <SurfaceCard style={styles.summaryCard}>
        <Text style={styles.summaryEyebrow}>{isGuest ? 'Guest Session' : 'Signed In'}</Text>
        <Text style={styles.summaryTitle}>{isGuest ? 'Explore before you commit' : user?.email || 'Account'}</Text>
        <Text style={styles.summaryDescription}>
          {isGuest
            ? 'Guest sessions let you browse your stats and uploads before creating an account.'
            : 'Your sessions, uploads, chat history, and friends all stay tied to this account.'}
        </Text>
      </SurfaceCard>

      <SurfaceCard style={styles.actionsCard} tone="raised">
        <Text style={styles.actionsTitle}>{isGuest ? 'Ready to save your progress?' : 'Session actions'}</Text>
        <Text style={styles.actionsDescription}>
          {isGuest
            ? 'Create an account to keep your logs and sync the same Bowling Tracker data on every device.'
            : 'You can sign out at any time. The app will drop back into a guest session so you can keep using it.'}
        </Text>

        {isGuest ? (
          <ActionButton
            label="Sign in / Create account"
            onPress={() => router.push('/login')}
            variant="primary"
          />
        ) : (
          <ActionButton
            label={busy ? 'Signing out...' : 'Sign out to guest session'}
            onPress={handleSignOut}
            disabled={busy}
            variant="secondary"
          />
        )}
      </SurfaceCard>

      {isGuest ? (
        <InfoBanner text="Guest mode is active. If you sign in later, the app can move your guest logs into that account." />
      ) : null}

      {error ? <InfoBanner text={error} tone="error" /> : null}

      <View style={styles.actions}>
        {!isGuest ? <Text style={styles.footerNote}>Signing out keeps the app usable by immediately starting a fresh guest session.</Text> : null}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  summaryEyebrow: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    fontFamily: fontFamilySans,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryTitle: {
    color: palette.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  summaryDescription: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  actionsCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  actionsTitle: {
    color: palette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  actionsDescription: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  actions: {
    gap: spacing.sm,
  },
  footerNote: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
});
