import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import ActionButton from '@/components/action-button';
import InfoBanner from '@/components/info-banner';
import SafeRedirect from '@/components/safe-redirect';
import ScreenShell from '@/components/screen-shell';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { queryKeys, updateOwnProfile } from '@/lib/backend';
import { formatHandle, normalizeUsernameInput } from '@/lib/profile';
import { useAuth } from '@/providers/auth-provider';

function getSafeNextPath(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/(tabs)/sessions';
  }
  if (
    trimmed.startsWith('/login') ||
    trimmed.startsWith('/complete-profile') ||
    trimmed.startsWith('/choose-avatar')
  ) {
    return '/(tabs)/sessions';
  }
  return trimmed || '/(tabs)/sessions';
}

export default function CompleteProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ next?: string }>();
  const { user, loading, isGuest, profile, refreshProfile } = useAuth();
  const nextPath = useMemo(() => getSafeNextPath(params.next), [params.next]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setFirstName(profile?.firstName ?? '');
    setLastName(profile?.lastName ?? '');
    setUsername(profile?.username ?? profile?.usernameSuggestion ?? '');
  }, [
    profile?.firstName,
    profile?.lastName,
    profile?.username,
    profile?.usernameSuggestion,
  ]);

  if (loading) {
    return <ScreenShell title="Complete Profile" subtitle="Loading account..." />;
  }

  if (!user || isGuest) {
    return <SafeRedirect href="/login" />;
  }

  if (profile?.profileComplete) {
    if (profile.avatarStepNeeded) {
      return <SafeRedirect href={`/choose-avatar?next=${encodeURIComponent(nextPath)}`} />;
    }
    return <SafeRedirect href={nextPath as Href} />;
  }

  const handleSave = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await updateOwnProfile({
        firstName,
        lastName,
        username: normalizeUsernameInput(username),
      });

      const refreshed = await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard });
      if (refreshed?.avatarStepNeeded) {
        router.replace(`/choose-avatar?next=${encodeURIComponent(nextPath)}`);
        return;
      }

      router.replace(nextPath as Href);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell
      title="Complete Profile"
      subtitle="Add the public details your friends will see in PinPoint.">
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <View style={[styles.formGroup, styles.nameField]}>
            <Text style={styles.label}>First Name</Text>
            <TextInput
              placeholder="First name"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
            />
          </View>
          <View style={[styles.formGroup, styles.nameField]}>
            <Text style={styles.label}>Last Name</Text>
            <TextInput
              placeholder="Optional"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
            />
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="username"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={username}
            onChangeText={setUsername}
          />
          <Text style={styles.helper}>Shown publicly as {formatHandle(username || 'username')}</Text>
        </View>

        <InfoBanner text="Last name stays private to your account." />
        {error ? <InfoBanner text={error} tone="error" /> : null}

        <ActionButton
          label="Continue"
          onPress={handleSave}
          disabled={!firstName.trim() || !normalizeUsernameInput(username) || busy}
          loading={busy}
        />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  nameRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  nameField: {
    flex: 1,
  },
  formGroup: {
    gap: spacing.sm,
  },
  label: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  input: {
    backgroundColor: palette.field,
    color: palette.text,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fontFamilySans,
  },
  helper: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
});
