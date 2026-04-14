import * as AppleAuthentication from 'expo-apple-authentication';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import CenteredState from '@/components/centered-state';
import InfoBanner from '@/components/info-banner';
import KeyboardAwareScrollView from '@/components/keyboard-aware-scroll-view';
import SafeRedirect from '@/components/safe-redirect';
import SurfaceCard from '@/components/surface-card';
import { checkUsernameAvailability } from '@/lib/backend';
import { claimGuest } from '@/lib/backend';
import { DEFAULT_POST_AUTH_PATH, getSafePostAuthPath } from '@/lib/onboarding';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { formatHandle, normalizeUsernameInput } from '@/lib/profile';
import { getExistingSessionSnapshot, isGuestUser } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

type AuthMode = 'signIn' | 'signUp';

type TransferPrompt = {
  guestAccessToken: string;
  guestUserId: string;
};

type AuthAction = 'password' | 'apple' | 'google' | null;

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string; mode?: string }>();
  const {
    user,
    loading,
    isGuest,
    profileComplete,
    avatarStepNeeded,
    tutorialSeen,
    signInWithApple,
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
  } = useAuth();
  const requestedMode: AuthMode = params.mode === 'signUp' ? 'signUp' : 'signIn';
  const [mode, setMode] = useState<AuthMode>(requestedMode);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
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
  const pagerRef = useRef<ScrollView | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pagerWidth = Math.max(0, Math.round(windowWidth - insets.left - insets.right));

  const nextPath = useMemo(
    () => getSafePostAuthPath(params.next, DEFAULT_POST_AUTH_PATH),
    [params.next],
  );
  const currentSubtitle =
    mode === 'signIn'
      ? 'Sign in to access your sessions, uploads, chat, and friends.'
      : 'Create an account to save your logs and access them on every device.';

  const scrollToMode = (nextMode: AuthMode, animated: boolean) => {
    if (!pagerWidth) {
      return;
    }

    pagerRef.current?.scrollTo({
      x: nextMode === 'signUp' ? pagerWidth : 0,
      y: 0,
      animated,
    });
  };

  const handleModePress = (nextMode: AuthMode) => {
    if (nextMode === mode) {
      return;
    }

    setMode(nextMode);
    scrollToMode(nextMode, true);
  };

  useEffect(() => {
    setMode(requestedMode);
  }, [requestedMode]);

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

  useEffect(() => {
    if (!pagerWidth) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      scrollToMode(mode, false);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [mode, pagerWidth]);

  if (loading) {
    return <CenteredState title="Loading account..." loading />;
  }

  if (
    user &&
    !isGuest &&
    !transferPrompt &&
    !busy &&
    !transferBusy &&
    profileComplete &&
    !avatarStepNeeded &&
    tutorialSeen
  ) {
    return <SafeRedirect href={nextPath as Href} />;
  }

  const finishAuthentication = async (guestAccessToken: string, guestUserId: string) => {
    const afterSession = await getExistingSessionSnapshot();
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

      return false;
    }

    return false;
  };

  const handleSubmit = async (targetMode: AuthMode) => {
    if (busy || transferBusy) {
      return;
    }

    setBusy(true);
    setActiveAction('password');
    setError('');
    setInfo('');
    setTransferError('');

    try {
      const beforeSession = await getExistingSessionSnapshot();
      const guestBefore =
        beforeSession.user && beforeSession.accessToken && isGuestUser(beforeSession.user)
          ? {
              guestAccessToken: beforeSession.accessToken,
              guestUserId: beforeSession.user.id,
            }
          : null;

      if (targetMode === 'signIn') {
        await signInWithPassword(email.trim(), password);
      } else {
        const normalizedUsername = normalizeUsernameInput(username);
        const usernameCheck = await checkUsernameAvailability(normalizedUsername);
        if (!usernameCheck.available) {
          throw new Error('That username is already taken.');
        }

        await signUpWithPassword({
          firstName,
          lastName,
          username: normalizedUsername,
          email: email.trim(),
          password,
        });
      }

      if (
        guestBefore &&
        (await finishAuthentication(guestBefore.guestAccessToken, guestBefore.guestUserId))
      ) {
        return;
      }

      const afterSession = await getExistingSessionSnapshot();
      const nextUser = afterSession.user;
      if (nextUser && !isGuestUser(nextUser)) {
        return;
      }

      if (targetMode === 'signUp') {
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
      const beforeSession = await getExistingSessionSnapshot();
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

      const afterSession = await getExistingSessionSnapshot();
      if (afterSession.user && !isGuestUser(afterSession.user)) {
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
      const beforeSession = await getExistingSessionSnapshot();
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

      const afterSession = await getExistingSessionSnapshot();
      if (afterSession.user && !isGuestUser(afterSession.user)) {
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

  const handleStartBlank = () => {
    if (transferBusy) {
      return;
    }
    setTransferPrompt(null);
    setTransferError('');
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
    } catch (nextError) {
      setTransferError(
        nextError instanceof Error ? nextError.message : 'Failed to move guest logs.',
      );
    } finally {
      setTransferBusy(false);
    }
  };

  const renderAuthPage = (pageMode: AuthMode) => (
    <View style={styles.pageContentInner}>
      {pageMode === 'signUp' ? (
        <>
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
            <Text style={styles.helperText}>
              Publicly shown as {formatHandle(normalizeUsernameInput(username) || 'username')}
            </Text>
          </View>
        </>
      ) : null}

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
        label={pageMode === 'signIn' ? 'Sign In' : 'Create Account'}
        onPress={() => handleSubmit(pageMode)}
        disabled={
          busy ||
          transferBusy ||
          !email.trim() ||
          !password ||
          (pageMode === 'signUp' && (!firstName.trim() || !normalizeUsernameInput(username)))
        }
        loading={activeAction === 'password'}
      />
    </View>
  );

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
            <Pressable
              onPress={() => router.replace(`/welcome?next=${encodeURIComponent(nextPath)}` as never)}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <Ionicons name="chevron-back" size={16} color={palette.muted} />
              <Text style={styles.backText}>Welcome</Text>
            </Pressable>
            <Text style={styles.headerTitle}>PinPoint</Text>
            <Text style={styles.headerSubtitle}>{currentSubtitle}</Text>
          </View>

          <View style={styles.socialActions}>
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
          </View>

          <View style={styles.modeRowWrap}>
            <View style={styles.modeRow}>
              <View style={styles.modeGroup}>
                <Pressable
                  onPress={() => handleModePress('signIn')}
                  style={({ pressed }) => [styles.modePressable, pressed && styles.pressed]}>
                  <Text
                    style={[
                      styles.modeButtonText,
                      mode === 'signIn' && styles.modeButtonTextActive,
                    ]}>
                    Sign In
                  </Text>
                </Pressable>
                {mode === 'signIn' ? <View style={styles.modeIndicator} /> : <View style={styles.modeSpacer} />}
              </View>
              <View style={styles.modeGroup}>
                <Pressable
                  onPress={() => handleModePress('signUp')}
                  style={({ pressed }) => [styles.modePressable, pressed && styles.pressed]}>
                  <Text
                    style={[
                      styles.modeButtonText,
                      mode === 'signUp' && styles.modeButtonTextActive,
                    ]}>
                    Create Account
                  </Text>
                </Pressable>
                {mode === 'signUp' ? <View style={styles.modeIndicator} /> : <View style={styles.modeSpacer} />}
              </View>
            </View>
          </View>

          <View style={[styles.pagerViewport, pagerWidth ? { width: pagerWidth } : null]}>
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              nestedScrollEnabled
              directionalLockEnabled
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onMomentumScrollEnd={(event) => {
                if (!pagerWidth) {
                  return;
                }

                const nextMode =
                  Math.round(event.nativeEvent.contentOffset.x / pagerWidth) === 1
                    ? 'signUp'
                    : 'signIn';
                setMode(nextMode);
              }}>
              <View style={[styles.pagerPage, pagerWidth ? { width: pagerWidth } : null]}>
                {renderAuthPage('signIn')}
              </View>
              <View style={[styles.pagerPage, pagerWidth ? { width: pagerWidth } : null]}>
                {renderAuthPage('signUp')}
              </View>
            </ScrollView>
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
    flexGrow: 1,
  },
  header: {
    gap: spacing.md,
  },
  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  backText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
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
  socialActions: {
    gap: spacing.sm,
  },
  modeRowWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    alignSelf: 'center',
  },
  modeGroup: {
    gap: spacing.xs,
  },
  modePressable: {
    alignSelf: 'flex-start',
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
  pagerViewport: {
    alignSelf: 'center',
    overflow: 'hidden',
  },
  pagerPage: {
    paddingHorizontal: spacing.lg,
    flexShrink: 0,
  },
  pageContentInner: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    gap: spacing.lg,
    paddingTop: spacing.sm,
  },
  formGroup: {
    gap: spacing.sm,
  },
  nameRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  nameField: {
    flex: 1,
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
  helperText: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
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
  pressed: {
    opacity: 0.85,
  },
  modalText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
});
