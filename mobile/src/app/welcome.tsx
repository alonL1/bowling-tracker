import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import CenteredState from '@/components/centered-state';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { DEFAULT_POST_AUTH_PATH, getSafePostAuthPath } from '@/lib/onboarding';
import { useAuth } from '@/providers/auth-provider';

const HIGHLIGHTS = [
  {
    key: 'capture',
    renderIcon: (size: number) => <Ionicons name="camera" size={size} color={palette.text} />,
    text: 'Capture scoreboards, review results, and get data automatically recorded.',
  },
  {
    key: 'sessions',
    renderIcon: (size: number) => (
      <MaterialCommunityIcons name="book-open-page-variant" size={size + 2} color={palette.text} />
    ),
    text: 'Keep sessions, games, stats, and trends in one clean log.',
  },
  {
    key: 'chat',
    renderIcon: (size: number) => (
      <Ionicons name="chatbubble-ellipses" size={size} color={palette.text} />
    ),
    text: 'Ask our AI chat anything about your bowling data anytime.',
  },
  {
    key: 'friends',
    renderIcon: (size: number) => <Ionicons name="people" size={size} color={palette.text} />,
    text: 'Compare stats with friends and see how your bowling stacks up.',
  },
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10;
}

function buildWelcomeMetrics(width: number, height: number) {
  const widthScale = clamp(width / 390, 0.86, 1.04);
  const rawHeightScale = height / 900;
  const heightScale = clamp(Math.pow(rawHeightScale, 1.06), 0.62, 1.02);
  const scale = Math.min(widthScale, heightScale);

  return {
    pageHorizontal: Math.round(clamp(20 * widthScale, 14, 20)),
    pageTop: Math.round(clamp(20 * heightScale, 10, 20)),
    pageBottom: Math.round(clamp(24 * heightScale, 12, 24)),
    topGap: Math.round(clamp(24 * scale, 12, 24)),
    bottomGap: Math.round(clamp(16 * scale, 10, 16)),
    headerGap: Math.round(clamp(16 * scale, 8, 16)),
    brandSize: roundToTenth(clamp(42 * scale, 28, 42)),
    brandLine: roundToTenth(clamp(46 * scale, 32, 46)),
    pinSize: Math.round(clamp(132 * scale, 88, 132)),
    pinRightMargin: Math.round(clamp(8 * widthScale, 4, 8)),
    titleSize: roundToTenth(clamp(40 * scale, 26, 40)),
    titleLine: roundToTenth(clamp(44 * scale, 30, 44)),
    highlightListGap: Math.round(clamp(16 * scale, 8, 16)),
    highlightRowGap: Math.round(clamp(16 * scale, 8, 16)),
    highlightIconSize: Math.round(clamp(44 * scale, 30, 44)),
    highlightIconGlyph: roundToTenth(clamp(16 * scale, 12, 16)),
    highlightTextSize: roundToTenth(clamp(17 * scale, 13, 17)),
    highlightTextLine: roundToTenth(clamp(24 * scale, 17, 24)),
    actionsGap: Math.round(clamp(8 * scale, 6, 8)),
    secondaryRowGap: Math.round(clamp(8 * scale, 6, 8)),
    buttonMinHeight: Math.round(clamp(52 * scale, 44, 52)),
    buttonTextSize: roundToTenth(clamp(16 * scale, 14, 16)),
    footerSize: roundToTenth(clamp(14 * scale, 12, 14)),
    footerLine: roundToTenth(clamp(19 * scale, 16, 19)),
    glowTopSize: Math.round(clamp(260 * scale, 180, 260)),
    glowBottomSize: Math.round(clamp(240 * scale, 160, 240)),
  };
}

export default function WelcomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { loading, continueAsGuest } = useAuth();
  const [guestBusy, setGuestBusy] = useState(false);
  const [error, setError] = useState('');
  const nextPath = useMemo(() => getSafePostAuthPath(params.next), [params.next]);
  const safeWidth = Math.max(0, Math.round(windowWidth - insets.left - insets.right));
  const safeHeight = Math.max(0, Math.round(windowHeight - insets.top - insets.bottom));
  const metrics = useMemo(
    () => buildWelcomeMetrics(safeWidth || windowWidth, safeHeight || windowHeight),
    [safeHeight, safeWidth, windowHeight, windowWidth],
  );

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
      <View
        style={[
          styles.page,
          {
            paddingHorizontal: metrics.pageHorizontal,
            paddingTop: metrics.pageTop,
            paddingBottom: metrics.pageBottom,
          },
        ]}>
        <View
          style={[
            styles.glowTop,
            {
              width: metrics.glowTopSize,
              height: metrics.glowTopSize,
              top: -Math.round(metrics.glowTopSize * 0.27),
              right: -Math.round(metrics.glowTopSize * 0.15),
            },
          ]}
        />
        <View
          style={[
            styles.glowBottom,
            {
              width: metrics.glowBottomSize,
              height: metrics.glowBottomSize,
              bottom: -Math.round(metrics.glowBottomSize * 0.38),
              left: -Math.round(metrics.glowBottomSize * 0.3),
            },
          ]}
        />

        <View style={[styles.topContent, { gap: metrics.topGap }]}>
          <View style={styles.heroHeader}>
            <Text
              style={[
                styles.brandTitle,
                {
                  fontSize: metrics.brandSize,
                  lineHeight: metrics.brandLine,
                },
              ]}>
              PinPoint
            </Text>
            <Image
              source={require('../../assets/pins/happy_pin.png')}
              alt=""
              style={[
                styles.heroPin,
                {
                  width: metrics.pinSize,
                  height: metrics.pinSize,
                  marginRight: metrics.pinRightMargin,
                },
              ]}
              resizeMode="contain"
            />
          </View>

          <View style={[styles.hero, { gap: metrics.headerGap }]}>
            <View style={styles.heroText}>
              <Text
                style={[
                  styles.heroTitle,
                  {
                    fontSize: metrics.titleSize,
                    lineHeight: metrics.titleLine,
                  },
                ]}>
                Bowling logs that start with a photo.
              </Text>
            </View>
          </View>

          <View style={[styles.highlightList, { gap: metrics.highlightListGap }]}>
            {HIGHLIGHTS.map((item) => (
              <View
                key={item.key}
                style={[styles.highlightRow, { gap: metrics.highlightRowGap }]}>
                <View
                  style={[
                    styles.highlightIcon,
                    {
                      width: metrics.highlightIconSize,
                      height: metrics.highlightIconSize,
                      borderRadius: metrics.highlightIconSize / 2,
                    },
                  ]}>
                  {item.renderIcon(metrics.highlightIconGlyph)}
                </View>
                <Text
                  style={[
                    styles.highlightText,
                    {
                      fontSize: metrics.highlightTextSize,
                      lineHeight: metrics.highlightTextLine,
                    },
                  ]}>
                  {item.text}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.bottomContent, { gap: metrics.bottomGap }]}>
          {error ? (
            <Text
              style={[
                styles.errorText,
                {
                  fontSize: metrics.footerSize,
                  lineHeight: metrics.footerLine,
                },
              ]}>
              {error}
            </Text>
          ) : null}

          <View style={[styles.actions, { gap: metrics.actionsGap }]}>
            <ActionButton
              label="Get Started"
              onPress={() =>
                router.push(
                  `/login?mode=signUp&next=${encodeURIComponent(nextPath || DEFAULT_POST_AUTH_PATH)}` as never,
                )
              }
              style={{ minHeight: metrics.buttonMinHeight }}
              textStyle={{ fontSize: metrics.buttonTextSize }}
            />

            <ActionButton
              label="Sign In"
              onPress={() =>
                router.push(
                  `/login?mode=signIn&next=${encodeURIComponent(nextPath || DEFAULT_POST_AUTH_PATH)}` as never,
                )
              }
              variant="secondary"
              style={{ minHeight: metrics.buttonMinHeight }}
              textStyle={{ fontSize: metrics.buttonTextSize }}
            />

            <View style={[styles.secondaryActionRow, { gap: metrics.secondaryRowGap }]}>
              <ActionButton
                label="Learn More"
                onPress={() => router.push('/getting-started?preview=1' as never)}
                variant="secondary"
                style={[styles.secondaryAction, { minHeight: metrics.buttonMinHeight }]}
                textStyle={{ fontSize: metrics.buttonTextSize }}
              />
              <ActionButton
                label="Continue as Guest"
                onPress={handleGuest}
                loading={guestBusy}
                disabled={guestBusy}
                variant="secondary"
                style={[styles.secondaryAction, { minHeight: metrics.buttonMinHeight }]}
                textStyle={{ fontSize: metrics.buttonTextSize }}
              />
            </View>
          </View>

          <View style={[styles.footer, { gap: metrics.secondaryRowGap }]}>
            <Pressable
              onPress={() => router.push('/privacy')}
              style={({ pressed }) => pressed && styles.pressed}>
              <Text
                style={[
                  styles.footerLink,
                  {
                    fontSize: metrics.footerSize,
                    lineHeight: metrics.footerLine,
                  },
                ]}>
                Privacy
              </Text>
            </Pressable>
            <Text
              style={[
                styles.footerDot,
                {
                  fontSize: metrics.footerSize,
                  lineHeight: metrics.footerLine,
                },
              ]}>
              •
            </Text>
            <Pressable
              onPress={() => router.push('/terms')}
              style={({ pressed }) => pressed && styles.pressed}>
              <Text
                style={[
                  styles.footerLink,
                  {
                    fontSize: metrics.footerSize,
                    lineHeight: metrics.footerLine,
                  },
                ]}>
                Terms
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  page: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: palette.background,
    overflow: 'hidden',
  },
  glowTop: {
    position: 'absolute',
    top: -70,
    right: -40,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: 'rgba(79, 118, 166, 0.14)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -90,
    left: -70,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: 'rgba(145, 178, 224, 0.08)',
  },
  topContent: {
    gap: spacing.lg,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  brandTitle: {
    flex: 1,
    color: palette.muted,
    fontSize: 42,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: 0.6,
    fontFamily: fontFamilySans,
  },
  hero: {
    gap: spacing.md,
  },
  heroPin: {
    width: 132,
    height: 132,
    marginRight: spacing.sm,
  },
  heroText: {
    gap: spacing.sm,
  },
  heroTitle: {
    color: palette.text,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  highlightList: {
    gap: spacing.md,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  highlightIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
  },
  highlightText: {
    flex: 1,
    color: palette.muted,
    fontSize: 17,
    lineHeight: 24,
    fontFamily: fontFamilySans,
  },
  bottomContent: {
    gap: spacing.md,
  },
  actions: {
    gap: spacing.sm,
  },
  secondaryActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryAction: {
    flex: 1,
  },
  errorText: {
    color: palette.error,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
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
