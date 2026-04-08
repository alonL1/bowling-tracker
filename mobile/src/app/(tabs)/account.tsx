import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import ActionButton from '@/components/action-button';
import InfoBanner from '@/components/info-banner';
import ProfileAvatar from '@/components/profile-avatar';
import ScreenShell from '@/components/screen-shell';
import SurfaceCard from '@/components/surface-card';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { formatHandle } from '@/lib/profile';
import { useAuth } from '@/providers/auth-provider';
import { useUploadsProcessing } from '@/providers/uploads-processing-provider';

export default function AccountScreen() {
  const router = useRouter();
  const { user, isGuest, profile, signOutToGuestSession } = useAuth();
  const { summary } = useUploadsProcessing();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const profileName =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() ||
    profile?.firstName ||
    'PinPoint Account';

  const handleSignOut = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await signOutToGuestSession();
      router.replace('/login');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to sign out.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell title="Account">
      {!isGuest ? (
        <SurfaceCard style={styles.summaryCard}>
          <Text style={styles.summaryEyebrow}>Signed In</Text>
          <View style={styles.profileSummaryRow}>
            <ProfileAvatar
              size={72}
              avatarKind={profile?.avatarKind}
              avatarPresetId={profile?.avatarPresetId}
              avatarUrl={profile?.avatarUrl}
              initials={profile?.initials}
              firstName={profile?.firstName}
              lastName={profile?.lastName}
              username={profile?.username}
            />
            <View style={styles.profileSummaryText}>
              <Text style={styles.summaryTitle}>{profileName}</Text>
              <Text style={styles.summaryHandle}>{formatHandle(profile?.username)}</Text>
              <Text style={[styles.summaryDescription, styles.summaryEmail]}>
                {user?.email || 'Account'}
              </Text>
            </View>
          </View>
          <Text style={styles.summaryDescription}>
            Your sessions, uploads, chat, and friends all stay tied to this account profile.
          </Text>
        </SurfaceCard>
      ) : null}

      {isGuest ? (
        <SurfaceCard style={styles.actionsCard} tone="raised">
          <Text style={styles.actionsTitle}>Ready to save your progress?</Text>
          <Text style={styles.actionsDescription}>
            Create an account to never lose your logs, add friends, and sync the same PinPoint data on every device.
          </Text>
          <ActionButton
            label="Sign in / Create account"
            onPress={() => router.push('/login')}
            variant="primary"
          />
        </SurfaceCard>
      ) : (
        <View style={styles.actions}>
          <ActionButton
            label="Edit Profile"
            onPress={() => router.push('/edit-profile')}
            variant="secondary"
          />
          <ActionButton
            label="Sign out"
            onPress={handleSignOut}
            disabled={busy}
            loading={busy}
            variant="secondary"
          />
        </View>
      )}

      {isGuest ? (
        <InfoBanner text="Guest mode is active. If you sign in later, the app can move your guest logs into that account." />
      ) : null}

      {error ? <InfoBanner text={error} tone="error" /> : null}

      <SurfaceCard style={styles.linksCard} tone="raised">
        <Text style={styles.linksTitle}>Uploads & Processing</Text>
        <Text style={styles.linksDescription}>
          Pending uploads and failed scoreboards stay here until they finish, retry, or are deleted.
        </Text>

        <Pressable
          onPress={() => router.push('/uploads-processing' as never)}
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
          <View style={styles.linkRowText}>
            <Text style={styles.linkLabel}>Open Uploads & Processing</Text>
            <Text style={styles.linkMeta}>
              {summary.pendingCount} pending • {summary.failedCount} failed
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.muted} />
        </Pressable>
      </SurfaceCard>

      <SurfaceCard style={styles.linksCard} tone="raised">
        <Text style={styles.linksTitle}>Legal & Data</Text>
        <Text style={styles.linksDescription}>
          Review PinPoint policies or open the pages used for privacy and deletion requests.
        </Text>

        <View style={styles.linkList}>
          <Pressable
            onPress={() => router.push('/privacy')}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
            <Text style={styles.linkLabel}>Privacy Policy</Text>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </Pressable>

          <Pressable
            onPress={() => router.push('/terms')}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
            <Text style={styles.linkLabel}>Terms of Service</Text>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </Pressable>

          <Pressable
            onPress={() => router.push('/delete-account')}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
            <Text style={styles.linkLabel}>Delete Account</Text>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </Pressable>

          <Pressable
            onPress={() => router.push('/delete-data')}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
            <Text style={styles.linkLabel}>Delete Data</Text>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </Pressable>
        </View>
      </SurfaceCard>
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
  profileSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  profileSummaryText: {
    flex: 1,
    gap: 2,
  },
  summaryHandle: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  summaryEmail: {
    fontSize: 14,
    lineHeight: 20,
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
  linksCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  linksTitle: {
    color: palette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  linksDescription: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  linkList: {
    gap: spacing.sm,
  },
  linkRowText: {
    flex: 1,
    gap: 2,
  },
  linkRow: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: palette.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  linkLabel: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  linkMeta: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  pressed: {
    opacity: 0.9,
  },
});
