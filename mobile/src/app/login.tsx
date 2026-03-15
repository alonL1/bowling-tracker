import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import CenteredState from '@/components/centered-state';
import InfoBanner from '@/components/info-banner';
import SurfaceCard from '@/components/surface-card';
import { claimGuest } from '@/lib/backend';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { getSessionSnapshot, isGuestUser } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

type AuthMode = 'signIn' | 'signUp';

type TransferPrompt = {
  guestAccessToken: string;
  guestUserId: string;
};

function getSafeNextPath(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/(tabs)/sessions';
  }
  if (trimmed.startsWith('/login')) {
    return '/(tabs)/sessions';
  }
  return trimmed || '/(tabs)/sessions';
}

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const { user, loading, isGuest, signInWithPassword, signUpWithPassword, continueAsGuest } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [transferPrompt, setTransferPrompt] = useState<TransferPrompt | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState('');

  const nextPath = useMemo(() => getSafeNextPath(params.next) as Href, [params.next]);
  const title = mode === 'signIn' ? 'Sign In' : 'Create Account';

  if (loading) {
    return <CenteredState title="Loading account..." loading />;
  }

  if (user && !isGuest && !transferPrompt) {
    return <Redirect href={nextPath} />;
  }

  const handleSubmit = async () => {
    if (busy || transferBusy) {
      return;
    }

    setBusy(true);
    setError('');
    setInfo('');
    setTransferError('');

    try {
      const beforeSession = await getSessionSnapshot();
      const guestBefore =
        beforeSession.user && beforeSession.accessToken && isGuestUser(beforeSession.user)
          ? {
              guestAccessToken: beforeSession.accessToken,
              guestUserId: beforeSession.user.id,
            }
          : null;

      if (mode === 'signIn') {
        await signInWithPassword(email.trim(), password);
      } else {
        await signUpWithPassword(email.trim(), password);
      }

      const afterSession = await getSessionSnapshot();
      const nextUser = afterSession.user;

      if (nextUser && !isGuestUser(nextUser)) {
        if (guestBefore && guestBefore.guestUserId !== nextUser.id) {
          let hasGuestData = true;
          try {
            const check = await claimGuest(guestBefore.guestAccessToken, 'check');
            hasGuestData = (check.check?.total ?? 0) > 0;
          } catch {
            hasGuestData = true;
          }

          if (hasGuestData) {
            setTransferPrompt({
              guestAccessToken: guestBefore.guestAccessToken,
              guestUserId: guestBefore.guestUserId,
            });
            setInfo("You're signed in. Choose what to do with your guest logs.");
            return;
          }
        }

        router.replace(nextPath);
        return;
      }

      if (mode === 'signUp') {
        setInfo('Account created. If email confirmation is enabled, check your inbox.');
      } else {
        setInfo('Sign in did not finish yet. If confirmation is required, complete it first.');
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleGuest = async () => {
    if (busy || transferBusy) {
      return;
    }

    setBusy(true);
    setError('');
    setInfo('');

    try {
      if (!isGuest) {
        await continueAsGuest();
      }
      router.replace(nextPath);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to start guest session.');
    } finally {
      setBusy(false);
    }
  };

  const handleStartBlank = () => {
    if (transferBusy) {
      return;
    }
    setTransferPrompt(null);
    setTransferError('');
    router.replace(nextPath);
  };

  const handleSaveLogs = async () => {
    if (!transferPrompt || transferBusy) {
      return;
    }
    setTransferBusy(true);
    setTransferError('');
    try {
      await claimGuest(transferPrompt.guestAccessToken, 'move');
      setTransferPrompt(null);
      router.replace(nextPath);
    } catch (nextError) {
      setTransferError(
        nextError instanceof Error ? nextError.message : 'Failed to move guest logs.',
      );
    } finally {
      setTransferBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardWrap}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Bowling Tracker</Text>
            <Text style={styles.headerSubtitle}>
              Sign in to access your sessions, uploads, chat, and friends on mobile.
            </Text>
          </View>

          <SurfaceCard style={styles.card}>
            <View style={styles.modeRow}>
              <View style={styles.modeGroup}>
                <Text
                  onPress={() => setMode('signIn')}
                  style={[styles.modeButtonText, mode === 'signIn' && styles.modeButtonTextActive]}>
                  Sign In
                </Text>
                {mode === 'signIn' ? <View style={styles.modeIndicator} /> : <View style={styles.modeSpacer} />}
              </View>
              <View style={styles.modeGroup}>
                <Text
                  onPress={() => setMode('signUp')}
                  style={[styles.modeButtonText, mode === 'signUp' && styles.modeButtonTextActive]}>
                  Sign Up
                </Text>
                {mode === 'signUp' ? <View style={styles.modeIndicator} /> : <View style={styles.modeSpacer} />}
              </View>
            </View>

            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{title}</Text>
              <Text style={styles.cardSubtitle}>
                {mode === 'signIn'
                  ? 'Use your Bowling Tracker account to keep everything in sync.'
                  : 'Create an account to save your logs and access them on every device.'}
              </Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="name@example.com"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                secureTextEntry
                placeholder="Password"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={password}
                onChangeText={setPassword}
              />
            </View>

            {error ? <InfoBanner text={error} tone="error" /> : null}
            {info ? <InfoBanner text={info} /> : null}
            {isGuest ? <InfoBanner text="You are currently using a guest session." /> : null}

            <ActionButton
              label={busy ? 'Working...' : mode === 'signIn' ? 'Sign In' : 'Create Account'}
              onPress={handleSubmit}
              disabled={busy || transferBusy || !email.trim() || !password}
            />

            <ActionButton
              label="Continue as Guest"
              onPress={handleGuest}
              disabled={busy || transferBusy}
              variant="secondary"
            />
          </SurfaceCard>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal transparent animationType="fade" visible={Boolean(transferPrompt)}>
        <View style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>Move guest logs to this account?</Text>
            <Text style={styles.modalText}>
              You are signed in. Do you want to move your guest sessions and games to this
              account, or keep this account as-is?
            </Text>

            {transferError ? <InfoBanner text={transferError} tone="error" /> : null}

            <ActionButton
              label={transferBusy ? 'Saving logs...' : 'Save my logs'}
              onPress={handleSaveLogs}
              disabled={transferBusy}
            />

            <ActionButton
              label="Skip import"
              onPress={handleStartBlank}
              disabled={transferBusy}
              variant="secondary"
            />
          </SurfaceCard>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  keyboardWrap: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 28,
    paddingBottom: 60,
    gap: spacing.xl,
  },
  header: {
    gap: spacing.md,
  },
  headerTitle: {
    color: palette.text,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  headerSubtitle: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fontFamilySans,
    maxWidth: 480,
  },
  card: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  modeGroup: {
    gap: spacing.xs,
  },
  modeSpacer: {
    height: 3,
  },
  modeIndicator: {
    width: '100%',
    height: 3,
    borderRadius: radii.pill,
    backgroundColor: palette.accent,
  },
  modeButtonText: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  modeButtonTextActive: {
    color: palette.text,
  },
  cardHeader: {
    gap: spacing.xs,
  },
  cardTitle: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  cardSubtitle: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: palette.overlay,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalTitle: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  modalText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
});
