import * as AppleAuthentication from 'expo-apple-authentication';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import CenteredState from '@/components/centered-state';
import InfoBanner from '@/components/info-banner';
import KeyboardAwareScrollView from '@/components/keyboard-aware-scroll-view';
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

type AuthAction = 'password' | 'apple' | 'google' | 'guest' | null;

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
  const {
    user,
    loading,
    isGuest,
    signInWithApple,
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
    continueAsGuest,
  } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState<AuthAction>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false);
  const [transferPrompt, setTransferPrompt] = useState<TransferPrompt | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState('');

  const nextPath = useMemo(() => getSafeNextPath(params.next) as Href, [params.next]);
  useEffect(() => {
    let active = true;

    if (Platform.OS === 'web') {
      setAppleSignInAvailable(true);
      return () => {
        active = false;
      };
    }

    if (Platform.OS !== 'ios') {
      setAppleSignInAvailable(false);
      return () => {
        active = false;
      };
    }

    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (active) {
          setAppleSignInAvailable(available);
        }
      })
      .catch(() => {
        if (active) {
          setAppleSignInAvailable(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <CenteredState title="Loading account..." loading />;
  }

  if (user && !isGuest && !transferPrompt && !busy && !transferBusy) {
    return <Redirect href={nextPath} />;
  }

  const finishAuthentication = async (guestAccessToken: string, guestUserId: string) => {
    const afterSession = await getSessionSnapshot();
    const nextUser = afterSession.user;

    if (nextUser && !isGuestUser(nextUser)) {
      if (guestUserId !== nextUser.id) {
        let hasGuestData = true;
        try {
          const check = await claimGuest(guestAccessToken, 'check');
          hasGuestData = (check.check?.total ?? 0) > 0;
        } catch {
          hasGuestData = true;
        }

        if (hasGuestData) {
          setTransferPrompt({
            guestAccessToken,
            guestUserId,
          });
          setInfo("You're signed in. Choose what to do with your guest logs.");
          return true;
        }
      }

      router.replace(nextPath);
      return true;
    }

    return false;
  };

  const handleSubmit = async () => {
    if (busy || transferBusy) {
      return;
    }

    setBusy(true);
    setActiveAction('password');
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

      if (
        guestBefore &&
        (await finishAuthentication(guestBefore.guestAccessToken, guestBefore.guestUserId))
      ) {
        return;
      }

      const afterSession = await getSessionSnapshot();
      const nextUser = afterSession.user;
      if (nextUser && !isGuestUser(nextUser)) {
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
      setActiveAction(null);
    }
  };

  const handleGoogle = async () => {
    if (busy || transferBusy) {
      return;
    }

    setBusy(true);
    setActiveAction('google');
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

      const completed = await signInWithGoogle();
      if (!completed) {
        return;
      }

      if (
        guestBefore &&
        (await finishAuthentication(guestBefore.guestAccessToken, guestBefore.guestUserId))
      ) {
        return;
      }

      const afterSession = await getSessionSnapshot();
      if (afterSession.user && !isGuestUser(afterSession.user)) {
        router.replace(nextPath);
        return;
      }

      setError('Google sign-in did not finish yet. Try again.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Google sign-in failed.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  };

  const handleApple = async () => {
    if (busy || transferBusy) {
      return;
    }

    setBusy(true);
    setActiveAction('apple');
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

      const completed = await signInWithApple();
      if (!completed) {
        return;
      }

      if (
        guestBefore &&
        (await finishAuthentication(guestBefore.guestAccessToken, guestBefore.guestUserId))
      ) {
        return;
      }

      const afterSession = await getSessionSnapshot();
      if (afterSession.user && !isGuestUser(afterSession.user)) {
        router.replace(nextPath);
        return;
      }

      setError('Apple sign-in did not finish yet. Try again.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Apple sign-in failed.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  };

  const handleGuest = async () => {
    if (busy || transferBusy) {
      return;
    }

    setBusy(true);
    setActiveAction('guest');
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
      setActiveAction(null);
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
        behavior="padding"
        enabled={Platform.OS === 'ios'}
        style={styles.keyboardWrap}>
        <KeyboardAwareScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>PinPoint</Text>
            <Text style={styles.headerSubtitle}>
              {mode === 'signIn'
                ? 'Sign in to access your sessions, uploads, chat, and friends.'
                : 'Create an account to save your sessions, uploads, chat, and friends, and access them on every device.'}
            </Text>
          </View>

          <View style={styles.formSection}>
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
                  Create Account
                </Text>
                {mode === 'signUp' ? <View style={styles.modeIndicator} /> : <View style={styles.modeSpacer} />}
              </View>
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
              label={mode === 'signIn' ? 'Sign In' : 'Create Account'}
              onPress={handleSubmit}
              disabled={busy || transferBusy || !email.trim() || !password}
              loading={activeAction === 'password'}
            />

            {Platform.OS === 'ios' && appleSignInAvailable ? (
              activeAction === 'apple' ? (
                <ActionButton
                  label="Continue with Apple"
                  onPress={handleApple}
                  disabled={busy || transferBusy}
                  loading
                  variant="secondary"
                  leftIcon={<Ionicons name="logo-apple" size={18} color={palette.text} />}
                />
              ) : (
                <View
                  pointerEvents={busy || transferBusy ? 'none' : 'auto'}
                  style={busy || transferBusy ? styles.oauthButtonDisabled : undefined}>
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                    cornerRadius={14}
                    onPress={handleApple}
                    style={styles.appleButton}
                  />
                </View>
              )
            ) : null}

            {Platform.OS === 'web' && appleSignInAvailable ? (
              <ActionButton
                label="Continue with Apple"
                onPress={handleApple}
                disabled={busy || transferBusy}
                loading={activeAction === 'apple'}
                variant="secondary"
                leftIcon={<Ionicons name="logo-apple" size={18} color={palette.text} />}
              />
            ) : null}

            <ActionButton
              label="Continue with Google"
              onPress={handleGoogle}
              disabled={busy || transferBusy}
              loading={activeAction === 'google'}
              variant="secondary"
              leftIcon={<Ionicons name="logo-google" size={18} color={palette.text} />}
            />

            <ActionButton
              label="Continue as Guest"
              onPress={handleGuest}
              disabled={busy || transferBusy}
              loading={activeAction === 'guest'}
              variant="secondary"
            />
          </View>
        </KeyboardAwareScrollView>
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
              label="Save my logs"
              onPress={handleSaveLogs}
              disabled={transferBusy}
              loading={transferBusy}
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
  formSection: {
    gap: spacing.lg,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    alignSelf: 'center',
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
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  modeButtonTextActive: {
    color: palette.text,
    fontWeight: '700',
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
  appleButton: {
    width: '100%',
    height: 52,
  },
  oauthButtonDisabled: {
    opacity: 0.5,
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
