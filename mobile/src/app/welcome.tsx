import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import CenteredState from '@/components/centered-state';
import SurfaceCard from '@/components/surface-card';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { DEFAULT_POST_AUTH_PATH, getSafePostAuthPath } from '@/lib/onboarding';
import { useAuth } from '@/providers/auth-provider';

const BENEFITS = [
  {
    key: 'log-fast',
    title: 'Log bowling faster',
    body: 'Use Live Session, upload later, or sort a big batch of scoreboards at once.',
    icon: <Ionicons name="flash" size={18} color={palette.text} />,
  },
  {
    key: 'track-history',
    title: 'Keep every session organized',
    body: 'PinPoint turns scoreboard photos into sessions, games, and stats you can revisit.',
    icon: <MaterialCommunityIcons name="book-open-page-variant" size={18} color={palette.text} />,
  },
  {
    key: 'learn-more',
    title: 'Ask questions about your data',
    body: 'Compare with friends and use chat to learn from your own bowling history.',
    icon: <Ionicons name="chatbubble-ellipses" size={18} color={palette.text} />,
  },
] as const;

export default function WelcomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const { user, loading, continueAsGuest } = useAuth();
  const [guestBusy, setGuestBusy] = useState(false);
  const [error, setError] = useState('');
  const nextPath = useMemo(() => getSafePostAuthPath(params.next), [params.next]);

  if (loading) {
    return <CenteredState title="Loading account..." loading />;
  }

  const handleGuest = async () => {
    if (guestBusy) {
      return;
    }

    setGuestBusy(true);
    setError('');

    try {
      await continueAsGuest();
      router.replace(nextPath as never);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to start guest mode.');
      setGuestBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <SurfaceCard style={styles.heroCard} tone="raised">
          <View style={styles.heroGlowLarge} />
          <View style={styles.heroGlowSmall} />
          <View style={styles.heroTopRow}>
            <View style={styles.eyebrowPill}>
              <Text style={styles.eyebrow}>WELCOME TO PINPOINT</Text>
            </View>
            <View style={styles.heroPinWrap}>
              <Image
                source={require('../../assets/pins/happy_pin.png')}
                style={styles.heroPin}
                resizeMode="contain"
              />
            </View>
          </View>

          <View style={styles.heroTextBlock}>
            <Text style={styles.heroTitle}>Track every bowling session without typing it all in.</Text>
            <Text style={styles.heroBody}>
              PinPoint pulls names and scores from scoreboard photos, helps you review everything,
              and keeps your bowling history easy to explore.
            </Text>
          </View>

          <View style={styles.heroBadgeRow}>
            <View style={styles.heroBadge}>
              <Ionicons name="camera" size={14} color={palette.text} />
              <Text style={styles.heroBadgeText}>Photo-first logging</Text>
            </View>
            <View style={styles.heroBadge}>
              <Ionicons name="stats-chart" size={14} color={palette.text} />
              <Text style={styles.heroBadgeText}>Sessions, stats, chat</Text>
            </View>
          </View>
        </SurfaceCard>

        <View style={styles.benefitList}>
          {BENEFITS.map((benefit) => (
            <SurfaceCard key={benefit.key} style={styles.benefitCard}>
              <View style={styles.benefitIcon}>{benefit.icon}</View>
              <View style={styles.benefitText}>
                <Text style={styles.benefitTitle}>{benefit.title}</Text>
                <Text style={styles.benefitBody}>{benefit.body}</Text>
              </View>
            </SurfaceCard>
          ))}
        </View>

        {error ? (
          <SurfaceCard style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </SurfaceCard>
        ) : null}

        <View style={styles.actions}>
          <ActionButton
            label="Create Account"
            onPress={() =>
              router.push(
                `/login?mode=signUp&next=${encodeURIComponent(nextPath || DEFAULT_POST_AUTH_PATH)}` as never,
              )
            }
          />
          <ActionButton
            label="Sign In"
            onPress={() =>
              router.push(
                `/login?mode=signIn&next=${encodeURIComponent(nextPath || DEFAULT_POST_AUTH_PATH)}` as never,
              )
            }
            variant="secondary"
          />
          <ActionButton
            label="Continue as Guest"
            onPress={handleGuest}
            loading={guestBusy}
            disabled={guestBusy}
            variant="secondary"
          />
        </View>

        <View style={styles.footer}>
          <Pressable onPress={() => router.push('/privacy')} style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.footerLink}>Privacy</Text>
          </Pressable>
          <Text style={styles.footerDot}>•</Text>
          <Pressable onPress={() => router.push('/terms')} style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.footerLink}>Terms</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  scroll: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  heroCard: {
    overflow: 'hidden',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  heroGlowLarge: {
    position: 'absolute',
    top: -24,
    right: -8,
    width: 168,
    height: 168,
    borderRadius: 999,
    backgroundColor: 'rgba(79, 118, 166, 0.18)',
  },
  heroGlowSmall: {
    position: 'absolute',
    bottom: -30,
    left: -36,
    width: 128,
    height: 128,
    borderRadius: 999,
    backgroundColor: 'rgba(145, 178, 224, 0.12)',
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  eyebrowPill: {
    backgroundColor: 'rgba(3, 10, 18, 0.3)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  eyebrow: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.8,
    fontFamily: fontFamilySans,
  },
  heroPinWrap: {
    width: 90,
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPin: {
    width: 88,
    height: 88,
  },
  heroTextBlock: {
    gap: spacing.sm,
  },
  heroTitle: {
    color: palette.text,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  heroBody: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 23,
    fontFamily: fontFamilySans,
    maxWidth: 560,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(3, 10, 18, 0.38)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  heroBadgeText: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  benefitList: {
    gap: spacing.sm,
  },
  benefitCard: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
  },
  benefitText: {
    flex: 1,
    gap: spacing.xs,
  },
  benefitTitle: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  benefitBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  errorCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: palette.danger,
  },
  errorText: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  actions: {
    gap: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  footerLink: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  footerDot: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  pressed: {
    opacity: 0.82,
  },
});
