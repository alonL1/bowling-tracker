import Entypo from '@expo/vector-icons/Entypo';
import Feather from '@expo/vector-icons/Feather';
import Fontisto from '@expo/vector-icons/Fontisto';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import CenteredState from '@/components/centered-state';
import InfoBanner from '@/components/info-banner';
import MultiPlayerFrameGrid from '@/components/multi-player-frame-grid';
import SurfaceCard from '@/components/surface-card';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import type { ResolvedLivePlayer } from '@/lib/live-session';
import { DEFAULT_POST_AUTH_PATH, getSafePostAuthPath } from '@/lib/onboarding';
import { useAuth } from '@/providers/auth-provider';

type TutorialCard = {
  key: string;
  title: string;
  body?: string;
};

type TutorialMetrics = ReturnType<typeof buildTutorialMetrics>;

const LIVE_REVIEW_PREVIEW_PLAYERS: ResolvedLivePlayer[] = [
  {
    playerName: 'Alon',
    playerKey: 'alon',
    totalScore: 137,
    frames: [
      { frame: 1, shots: [9, 1, null] },
      { frame: 2, shots: [9, 1, null] },
      { frame: 3, shots: [7, 3, null] },
      { frame: 4, shots: [6, 3, null] },
      { frame: 5, shots: [10, null, null] },
      { frame: 6, shots: [9, 0, null] },
      { frame: 7, shots: [9, 0, null] },
      { frame: 8, shots: [9, 1, null] },
      { frame: 9, shots: [6, 0, null] },
      { frame: 10, shots: [6, 4, 7] },
    ],
  },
  {
    playerName: 'Zay',
    playerKey: 'zay',
    totalScore: 121,
    frames: [
      { frame: 1, shots: [9, 0, null] },
      { frame: 2, shots: [10, null, null] },
      { frame: 3, shots: [8, 0, null] },
      { frame: 4, shots: [2, 8, null] },
      { frame: 5, shots: [8, 0, null] },
      { frame: 6, shots: [7, 3, null] },
      { frame: 7, shots: [6, 1, null] },
      { frame: 8, shots: [10, null, null] },
      { frame: 9, shots: [5, 4, null] },
      { frame: 10, shots: [9, 0, null] },
    ],
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10;
}

function buildTutorialMetrics(width: number, height: number) {
  const widthScale = clamp(width / 390, 0.88, 1.04);
  const rawHeightScale = height / 930;
  const heightScale = clamp(Math.pow(rawHeightScale, 1.08), 0.56, 1.02);
  const scale = Math.min(widthScale, heightScale);
  const pageHorizontal = Math.round(clamp(20 * widthScale, 14, 20));
  const slidePaddingHorizontal = Math.round(clamp(20 * scale, 12, 20));
  const windowPadding = Math.round(clamp(16 * scale, 10, 16));
  const boardAvailableWidth = Math.max(
    0,
    Math.round(width - pageHorizontal * 2 - slidePaddingHorizontal * 2 - windowPadding * 2),
  );
  const boardCompression = Math.max(0, Math.round((1 - heightScale) * 56));

  return {
    pageHorizontal,
    pageTop: Math.round(clamp(24 * heightScale, 10, 24)),
    pageBottom: Math.round(clamp(20 * heightScale, 10, 20)),
    pageGap: Math.round(clamp(24 * scale, 10, 24)),
    topLabelSize: roundToTenth(clamp(12 * scale, 10, 12)),
    topLabelLine: roundToTenth(clamp(16 * scale, 12, 16)),
    skipSize: roundToTenth(clamp(15 * scale, 12, 15)),
    skipLine: roundToTenth(clamp(20 * scale, 16, 20)),
    slidePaddingHorizontal,
    slidePaddingVertical: Math.round(clamp(24 * scale, 14, 24)),
    slideGap: Math.round(clamp(24 * scale, 10, 24)),
    cardTitleSize: roundToTenth(clamp(31 * scale, 22, 31)),
    cardTitleLine: roundToTenth(clamp(36 * scale, 26, 36)),
    cardBodySize: roundToTenth(clamp(16 * scale, 12.5, 16)),
    cardBodyLine: roundToTenth(clamp(23 * scale, 17, 23)),
    featureListGap: Math.round(clamp(16 * scale, 8, 16)),
    featureRowGap: Math.round(clamp(16 * scale, 8, 16)),
    featureIconSize: Math.round(clamp(36 * scale, 28, 36)),
    featureIconGlyph: roundToTenth(clamp(18 * scale, 14, 18)),
    featureTitleSize: roundToTenth(clamp(18 * scale, 14, 18)),
    featureTitleLine: roundToTenth(clamp(22 * scale, 18, 22)),
    featureBodySize: roundToTenth(clamp(15 * scale, 12, 15)),
    featureBodyLine: roundToTenth(clamp(21 * scale, 16, 21)),
    windowPadding,
    windowGap: Math.round(clamp(8 * scale, 4, 8)),
    windowTitleSize: roundToTenth(clamp(20 * scale, 15, 20)),
    windowTitleLine: roundToTenth(clamp(24 * scale, 18, 24)),
    recordTitleSize: roundToTenth(clamp(18 * scale, 14, 18)),
    recordTitleLine: roundToTenth(clamp(22 * scale, 17, 22)),
    recordBodySize: roundToTenth(clamp(13 * scale, 10.5, 13)),
    recordBodyLine: roundToTenth(clamp(18 * scale, 14, 18)),
    recordIconGlyph: roundToTenth(clamp(18 * scale, 14, 18)),
    pillTextSize: roundToTenth(clamp(12 * scale, 10, 12)),
    pillTextLine: roundToTenth(clamp(14 * scale, 11, 14)),
    selectionTitleSize: roundToTenth(clamp(15 * scale, 12, 15)),
    selectionTitleLine: roundToTenth(clamp(20 * scale, 15, 20)),
    selectionNameSize: roundToTenth(clamp(15 * scale, 12, 15)),
    selectionNameLine: roundToTenth(clamp(20 * scale, 15, 20)),
    selectionRowPaddingVertical: Math.round(clamp(8 * scale, 4, 8)),
    tabHeight: Math.round(clamp(40 * scale, 30, 40)),
    tabTextSize: roundToTenth(clamp(15 * scale, 12, 15)),
    tabTextLine: roundToTenth(clamp(20 * scale, 15, 20)),
    gameBadgeWidth: Math.round(clamp(62 * scale, 48, 62)),
    gameBadgeHeight: Math.round(clamp(58 * scale, 42, 58)),
    gameBadgeTextSize: roundToTenth(clamp(13 * scale, 10.5, 13)),
    gameBadgeTextLine: roundToTenth(clamp(16 * scale, 12, 16)),
    gameScoreSize: roundToTenth(clamp(18 * scale, 14, 18)),
    gameScoreLine: roundToTenth(clamp(22 * scale, 17, 22)),
    gameMetaSize: roundToTenth(clamp(15 * scale, 12, 15)),
    gameMetaLine: roundToTenth(clamp(19 * scale, 15, 19)),
    gameActionIcon: roundToTenth(clamp(18 * scale, 14, 18)),
    dotSize: Math.round(clamp(9 * scale, 7, 9)),
    dotActiveWidth: Math.round(clamp(28 * scale, 20, 28)),
    ctaMinHeight: Math.round(clamp(52 * scale, 44, 52)),
    ctaTextSize: roundToTenth(clamp(16 * scale, 14, 16)),
    reviewBoardWidth: Math.max(0, boardAvailableWidth - 20 - boardCompression),
  };
}

export default function GettingStartedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string; replay?: string; preview?: string }>();
  const { user, loading, isGuest, tutorialSeen, markTutorialSeen } = useAuth();
  const nextPath = useMemo(() => getSafePostAuthPath(params.next), [params.next]);
  const replay = params.replay === '1';
  const previewMode = !user && params.preview === '1';
  const pagerRef = useRef<ScrollView | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pagerWidth = Math.max(0, Math.round(windowWidth - insets.left - insets.right));
  const safeHeight = Math.max(0, Math.round(windowHeight - insets.top - insets.bottom));
  const tutorialMetrics = useMemo(
    () => buildTutorialMetrics(pagerWidth || windowWidth, safeHeight),
    [pagerWidth, safeHeight, windowWidth],
  );

  const cards = useMemo<TutorialCard[]>(
    () => [
      {
        key: 'record',
        title: 'Pick the logging flow that fits',
      },
      {
        key: 'review',
        title: 'Review before you save',
        body: 'PinPoint extracts the names and scores for you. Choose which player is you, then fix anything that looks off before it is logged.',
      },
      {
        key: 'explore',
        title: 'Explore your data after it is logged',
        body: !previewMode && isGuest
          ? 'Browse your Sessions, ask AI Chat anything about your bowling data, and create an account later to sync your history and unlock Friends.'
          : 'Browse your Sessions, compare stats on Friends, and use AI Chat to ask anything about your bowling data.',
      },
    ],
    [isGuest, previewMode],
  );

  useEffect(() => {
    if (!pagerWidth) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      pagerRef.current?.scrollTo({
        x: pageIndex * pagerWidth,
        y: 0,
        animated: false,
      });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [pageIndex, pagerWidth]);

  if (loading) {
    return <CenteredState title="Loading account..." loading />;
  }

  if ((!previewMode && !user) || (!previewMode && tutorialSeen && !replay)) {
    return <CenteredState title="Loading account..." loading />;
  }

  const finishTutorial = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError('');

    if (previewMode) {
      router.replace('/welcome' as Href);
      return;
    }

    try {
      await markTutorialSeen();
      router.replace(nextPath as Href);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to finish the tutorial.');
      setBusy(false);
    }
  };

  const handleNext = () => {
    if (pageIndex === cards.length - 1) {
      void finishTutorial();
      return;
    }

    const nextIndex = pageIndex + 1;
    setPageIndex(nextIndex);
    pagerRef.current?.scrollTo({
      x: nextIndex * pagerWidth,
      y: 0,
      animated: true,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View
        style={[
          styles.page,
          {
            paddingHorizontal: tutorialMetrics.pageHorizontal,
            paddingTop: tutorialMetrics.pageTop,
            paddingBottom: tutorialMetrics.pageBottom,
            gap: tutorialMetrics.pageGap,
          },
        ]}>
        <View style={styles.topBar}>
          <Text
            style={[
              styles.topLabel,
              { fontSize: tutorialMetrics.topLabelSize, lineHeight: tutorialMetrics.topLabelLine },
            ]}>
            {previewMode ? 'LEARN MORE' : replay ? 'TUTORIAL' : 'GETTING STARTED'}
          </Text>
          <Pressable
            onPress={() => void finishTutorial()}
            disabled={busy}
            style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}>
            <Text
              style={[
                styles.skipText,
                { fontSize: tutorialMetrics.skipSize, lineHeight: tutorialMetrics.skipLine },
              ]}>
              {previewMode ? 'Back' : 'Skip'}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.pagerViewport, pagerWidth ? { width: pagerWidth } : null]}>
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              if (!pagerWidth) {
                return;
              }
              setPageIndex(Math.round(event.nativeEvent.contentOffset.x / pagerWidth));
            }}>
            {cards.map((card, index) => (
              <View
                key={card.key}
                style={[
                  styles.slide,
                  pagerWidth ? { width: pagerWidth } : null,
                  { paddingHorizontal: tutorialMetrics.pageHorizontal },
                ]}>
                <SurfaceCard
                  style={[
                    styles.slideCard,
                    {
                      paddingHorizontal: tutorialMetrics.slidePaddingHorizontal,
                      paddingVertical: tutorialMetrics.slidePaddingVertical,
                      gap: tutorialMetrics.slideGap,
                    },
                  ]}
                  tone="raised">
                  {index === 0 ? (
                    <>
                      <Text
                        style={[
                          styles.cardTitle,
                          {
                            fontSize: tutorialMetrics.cardTitleSize,
                            lineHeight: tutorialMetrics.cardTitleLine,
                          },
                        ]}>
                        {card.title}
                      </Text>
                      <RecordTutorialPreview metrics={tutorialMetrics} />
                    </>
                  ) : null}

                  {index === 1 ? (
                    <>
                      <Text
                        style={[
                          styles.cardTitle,
                          {
                            fontSize: tutorialMetrics.cardTitleSize,
                            lineHeight: tutorialMetrics.cardTitleLine,
                          },
                        ]}>
                        {card.title}
                      </Text>
                      <View style={[styles.featureList, { gap: tutorialMetrics.featureListGap }]}>
                        <FeatureRow
                          icon={
                            <Ionicons
                              name="scan"
                              size={tutorialMetrics.featureIconGlyph}
                              color={palette.text}
                            />
                          }
                          title="PinPoint extracts the names and scores for you."
                          metrics={tutorialMetrics}
                        />
                        <FeatureRow
                          icon={
                            <Ionicons
                              name="person"
                              size={tutorialMetrics.featureIconGlyph}
                              color={palette.text}
                            />
                          }
                          title="Choose yourself"
                          metrics={tutorialMetrics}
                        />
                      </View>
                      <LiveReviewTutorialPreview metrics={tutorialMetrics} />
                    </>
                  ) : null}

                  {index === 2 ? (
                    <>
                      <Text
                        style={[
                          styles.cardTitle,
                          {
                            fontSize: tutorialMetrics.cardTitleSize,
                            lineHeight: tutorialMetrics.cardTitleLine,
                          },
                        ]}>
                        {card.title}
                      </Text>
                      {card.body ? (
                        <Text
                          style={[
                            styles.cardBody,
                            {
                              fontSize: tutorialMetrics.cardBodySize,
                              lineHeight: tutorialMetrics.cardBodyLine,
                            },
                          ]}>
                          {card.body}
                        </Text>
                      ) : null}
                      <View style={[styles.featureList, { gap: tutorialMetrics.featureListGap }]}>
                        <FeatureRow
                          icon={
                            <MaterialCommunityIcons
                              name="book-open-page-variant"
                              size={tutorialMetrics.featureIconGlyph + 2}
                              color={palette.text}
                            />
                          }
                          title="Sessions"
                          body="Your log of every session and game you have saved."
                          metrics={tutorialMetrics}
                        />
                        <FeatureRow
                          icon={
                            <Ionicons
                              name="people"
                              size={tutorialMetrics.featureIconGlyph}
                              color={palette.text}
                            />
                          }
                          title="Friends"
                          body={
                            !previewMode && isGuest
                              ? 'Create an account later to compare stats and invite friends.'
                              : 'Compare stats and see how your bowling stacks up.'
                          }
                          metrics={tutorialMetrics}
                        />
                        <FeatureRow
                          icon={
                            <Ionicons
                              name="chatbubble-ellipses"
                              size={tutorialMetrics.featureIconGlyph}
                              color={palette.text}
                            />
                          }
                          title="AI Chat"
                          body="Ask anything about your bowling data and get answers based on your history."
                          metrics={tutorialMetrics}
                        />
                      </View>
                    </>
                  ) : null}
                </SurfaceCard>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={[styles.dotsRow, { gap: tutorialMetrics.featureRowGap }]}>
          {cards.map((card, index) => (
            <Pressable
              key={card.key}
              onPress={() => {
                setPageIndex(index);
                pagerRef.current?.scrollTo({
                  x: index * pagerWidth,
                  y: 0,
                  animated: true,
                });
              }}
              style={[
                styles.dot,
                {
                  width: tutorialMetrics.dotSize,
                  height: tutorialMetrics.dotSize,
                },
                index === pageIndex && styles.dotActive,
                index === pageIndex && { width: tutorialMetrics.dotActiveWidth },
              ]}
            />
          ))}
        </View>

        {error ? <InfoBanner text={error} tone="error" /> : null}

        <ActionButton
          label={
            pageIndex === cards.length - 1
              ? previewMode
                ? 'Back to Welcome'
                : 'Get Started'
              : 'Next'
          }
          onPress={handleNext}
          loading={busy}
          disabled={busy}
          style={{ minHeight: tutorialMetrics.ctaMinHeight }}
          textStyle={{ fontSize: tutorialMetrics.ctaTextSize }}
        />
      </View>
    </SafeAreaView>
  );
}

function FeatureRow({
  icon,
  title,
  body,
  metrics,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  metrics: TutorialMetrics;
}) {
  return (
    <View style={[styles.featureRow, { gap: metrics.featureRowGap }]}>
      <View
        style={[
          styles.featureIcon,
          {
            width: metrics.featureIconSize,
            height: metrics.featureIconSize,
            borderRadius: metrics.featureIconSize / 2,
          },
        ]}>
        {icon}
      </View>
      <View style={styles.featureText}>
        <Text
          style={[
            styles.featureTitle,
            {
              fontSize: metrics.featureTitleSize,
              lineHeight: metrics.featureTitleLine,
            },
          ]}>
          {title}
        </Text>
        {body ? (
          <Text
            style={[
              styles.featureBody,
              {
                fontSize: metrics.featureBodySize,
                lineHeight: metrics.featureBodyLine,
              },
            ]}>
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function RecordTutorialPreview({ metrics }: { metrics: TutorialMetrics }) {
  return (
    <View
      style={[
        styles.mockScreenWindow,
        {
          paddingHorizontal: metrics.windowPadding,
          paddingVertical: metrics.windowPadding,
          gap: metrics.windowGap,
        },
      ]}>
      <Text
        style={[
          styles.mockScreenTitle,
          { fontSize: metrics.windowTitleSize, lineHeight: metrics.windowTitleLine },
        ]}>
        Record
      </Text>
      <View style={[styles.mockRecordList, { gap: metrics.windowGap }]}>
        <View
          style={[
            styles.mockRecordCard,
            {
              gap: metrics.featureRowGap,
              paddingHorizontal: metrics.windowPadding,
              paddingVertical: Math.max(8, Math.round(metrics.windowPadding * 0.9)),
            },
          ]}>
          <View style={[styles.mockRecordIcon, { width: Math.max(28, metrics.featureIconSize - 2) }]}>
            <Fontisto name="radio-btn-active" size={metrics.recordIconGlyph} color={palette.text} />
          </View>
          <View style={styles.mockRecordText}>
            <Text
              style={[
                styles.mockRecordTitle,
                { fontSize: metrics.recordTitleSize, lineHeight: metrics.recordTitleLine },
              ]}>
              Live Session
            </Text>
            <Text
              style={[
                styles.mockRecordBody,
                { fontSize: metrics.recordBodySize, lineHeight: metrics.recordBodyLine },
              ]}>
              Use this while you are bowling and add each scoreboard as you go.
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.mockRecordCard,
            {
              gap: metrics.featureRowGap,
              paddingHorizontal: metrics.windowPadding,
              paddingVertical: Math.max(8, Math.round(metrics.windowPadding * 0.9)),
            },
          ]}>
          <View style={[styles.mockRecordIcon, { width: Math.max(28, metrics.featureIconSize - 2) }]}>
            <Feather name="upload" size={metrics.recordIconGlyph} color={palette.text} />
          </View>
          <View style={styles.mockRecordText}>
            <Text
              style={[
                styles.mockRecordTitle,
                { fontSize: metrics.recordTitleSize, lineHeight: metrics.recordTitleLine },
              ]}>
              Upload Session
            </Text>
            <Text
              style={[
                styles.mockRecordBody,
                { fontSize: metrics.recordBodySize, lineHeight: metrics.recordBodyLine },
              ]}>
              Use this after a session when all the games belong together.
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.mockRecordCard,
            {
              gap: metrics.featureRowGap,
              paddingHorizontal: metrics.windowPadding,
              paddingVertical: Math.max(8, Math.round(metrics.windowPadding * 0.9)),
            },
          ]}>
          <View style={[styles.mockRecordIcon, { width: Math.max(28, metrics.featureIconSize - 2) }]}>
            <MaterialCommunityIcons
              name="card-multiple"
              size={metrics.recordIconGlyph + 1}
              color={palette.text}
            />
          </View>
          <View style={styles.mockRecordText}>
            <Text
              style={[
                styles.mockRecordTitle,
                { fontSize: metrics.recordTitleSize, lineHeight: metrics.recordTitleLine },
              ]}>
              Add Multiple Sessions
            </Text>
            <Text
              style={[
                styles.mockRecordBody,
                { fontSize: metrics.recordBodySize, lineHeight: metrics.recordBodyLine },
              ]}>
              Use this when you have a big batch and want PinPoint to sort them for you.
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function LiveReviewTutorialPreview({ metrics }: { metrics: TutorialMetrics }) {
  return (
    <View
      style={[
        styles.mockScreenWindow,
        {
          paddingHorizontal: metrics.windowPadding,
          paddingVertical: metrics.windowPadding,
          gap: metrics.windowGap,
        },
      ]}>
      <View style={styles.mockLiveHeader}>
        <Text
          style={[
            styles.mockScreenTitle,
            { fontSize: metrics.windowTitleSize, lineHeight: metrics.windowTitleLine },
          ]}>
          Live Session
        </Text>
        <View
          style={[
            styles.mockLivePill,
            {
              paddingHorizontal: Math.max(8, Math.round(metrics.windowPadding * 0.75)),
              paddingVertical: Math.max(4, Math.round(metrics.windowPadding * 0.35)),
            },
          ]}>
          <Text
            style={[
              styles.mockLivePillText,
              { fontSize: metrics.pillTextSize, lineHeight: metrics.pillTextLine },
            ]}>
            In progress
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.mockSelectionCard,
          {
            paddingHorizontal: metrics.windowPadding,
            paddingVertical: metrics.windowPadding,
            gap: Math.max(4, Math.round(metrics.windowGap * 0.75)),
          },
        ]}>
        <Text
          style={[
            styles.mockSelectionTitle,
            {
              fontSize: metrics.selectionTitleSize,
              lineHeight: metrics.selectionTitleLine,
            },
          ]}>
          Who are you?
        </Text>

        <View style={[styles.mockSelectionList, { gap: metrics.windowGap }]}>
          <View
            style={[
              styles.mockSelectionRow,
              {
                paddingHorizontal: metrics.windowPadding,
                paddingVertical: metrics.selectionRowPaddingVertical,
              },
            ]}>
            <View
              style={[
                styles.mockCheckbox,
                styles.mockCheckboxChecked,
                {
                  width: Math.max(18, Math.round(metrics.featureIconSize * 0.55)),
                  height: Math.max(18, Math.round(metrics.featureIconSize * 0.55)),
                },
              ]}>
              <Ionicons
                name="checkmark"
                size={Math.max(12, metrics.recordIconGlyph - 2)}
                color={palette.text}
              />
            </View>
            <Text
              style={[
                styles.mockSelectionName,
                {
                  fontSize: metrics.selectionNameSize,
                  lineHeight: metrics.selectionNameLine,
                },
              ]}>
              Alon
            </Text>
          </View>

          <View
            style={[
              styles.mockSelectionRow,
              {
                paddingHorizontal: metrics.windowPadding,
                paddingVertical: metrics.selectionRowPaddingVertical,
              },
            ]}>
            <View
              style={[
                styles.mockCheckbox,
                {
                  width: Math.max(18, Math.round(metrics.featureIconSize * 0.55)),
                  height: Math.max(18, Math.round(metrics.featureIconSize * 0.55)),
                },
              ]}>
              <Ionicons
                name="square-outline"
                size={metrics.recordIconGlyph}
                color={palette.muted}
              />
            </View>
            <Text
              style={[
                styles.mockSelectionName,
                {
                  fontSize: metrics.selectionNameSize,
                  lineHeight: metrics.selectionNameLine,
                },
              ]}>
              Zay
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.mockTabRow, { gap: metrics.windowGap }]}>
        <View style={[styles.mockTabButton, styles.mockTabButtonActive, { minHeight: metrics.tabHeight }]}>
          <Text
            style={[
              styles.mockTabText,
              styles.mockTabTextActive,
              { fontSize: metrics.tabTextSize, lineHeight: metrics.tabTextLine },
            ]}>
            Games
          </Text>
        </View>
        <View style={[styles.mockTabButton, { minHeight: metrics.tabHeight }]}>
          <Text
            style={[
              styles.mockTabText,
              { fontSize: metrics.tabTextSize, lineHeight: metrics.tabTextLine },
            ]}>
            Stats
          </Text>
        </View>
      </View>

      <View style={[styles.mockDotsRow, { gap: metrics.windowGap }]}>
        <View
          style={[
            styles.mockMiniDot,
            styles.mockMiniDotActive,
            { width: metrics.dotSize - 1, height: metrics.dotSize - 1 },
          ]}
        />
        <View style={[styles.mockMiniDot, { width: metrics.dotSize - 1, height: metrics.dotSize - 1 }]} />
      </View>

      <View style={[styles.mockGameRow, { gap: metrics.featureRowGap }]}>
        <View style={styles.mockGameSummary}>
          <View
            style={[
              styles.mockGameBadge,
              { width: metrics.gameBadgeWidth, minHeight: metrics.gameBadgeHeight },
            ]}>
            <Text
              style={[
                styles.mockGameBadgeLabel,
                {
                  fontSize: metrics.gameBadgeTextSize,
                  lineHeight: metrics.gameBadgeTextLine,
                },
              ]}>
              Game
            </Text>
            <Text
              style={[
                styles.mockGameBadgeValue,
                {
                  fontSize: metrics.gameBadgeTextSize,
                  lineHeight: metrics.gameBadgeTextLine,
                },
              ]}>
              1
            </Text>
          </View>
          <Text
            style={[
              styles.mockGameScore,
              { fontSize: metrics.gameScoreSize, lineHeight: metrics.gameScoreLine },
            ]}>
            137
          </Text>
        </View>

        <View style={[styles.mockGameActions, { gap: metrics.featureRowGap }]}>
          <Entypo name="pencil" size={metrics.gameActionIcon} color={palette.text} />
          <Ionicons name="trash" size={metrics.gameActionIcon} color={palette.text} />
          <Ionicons name="chevron-down" size={metrics.gameActionIcon} color={palette.text} />
        </View>
      </View>

      <Text
        style={[
          styles.mockGameMeta,
          { fontSize: metrics.gameMetaSize, lineHeight: metrics.gameMetaLine },
        ]}>
        Apr 7, 11:17 AM
      </Text>

      <View style={metrics.reviewBoardWidth ? { alignSelf: 'center', width: metrics.reviewBoardWidth } : null}>
        <MultiPlayerFrameGrid
          players={LIVE_REVIEW_PREVIEW_PLAYERS}
          selectedPlayerKeys={['alon']}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  page: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topLabel: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.8,
    fontFamily: fontFamilySans,
  },
  skipButton: {
    paddingVertical: spacing.xs,
  },
  skipText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  pagerViewport: {
    flex: 1,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  slide: {
    flex: 1,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
  },
  slideCard: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  cardTitle: {
    color: palette.text,
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  cardBody: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 23,
    fontFamily: fontFamilySans,
  },
  featureList: {
    gap: spacing.md,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  featureTitle: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  featureBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  mockScreenWindow: {
    borderRadius: radii.lg,
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  mockScreenTitle: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  mockRecordList: {
    gap: spacing.sm,
  },
  mockRecordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: palette.surfaceRaised,
  },
  mockRecordIcon: {
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mockRecordText: {
    flex: 1,
    gap: spacing.xs,
  },
  mockRecordTitle: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  mockRecordBody: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  mockLiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mockLivePill: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: palette.accent,
  },
  mockLivePillText: {
    color: palette.text,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  mockSelectionCard: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: palette.surfaceRaised,
  },
  mockSelectionTitle: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  mockSelectionList: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mockSelectionRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: palette.field,
  },
  mockCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mockCheckboxChecked: {
    backgroundColor: palette.accent,
  },
  mockSelectionName: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  mockTabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mockTabButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radii.lg,
    backgroundColor: palette.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mockTabButtonActive: {
    backgroundColor: palette.accent,
  },
  mockTabText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  mockTabTextActive: {
    color: palette.text,
  },
  mockDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  mockMiniDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(188, 199, 219, 0.32)',
  },
  mockMiniDotActive: {
    backgroundColor: palette.userChat,
  },
  mockGameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  mockGameSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  mockGameBadge: {
    width: 62,
    minHeight: 58,
    borderRadius: radii.lg,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  mockGameBadgeLabel: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 16,
    fontFamily: fontFamilySans,
  },
  mockGameBadgeValue: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 16,
    fontFamily: fontFamilySans,
  },
  mockGameScore: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  mockGameActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  mockGameMeta: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(188, 199, 219, 0.3)',
  },
  dotActive: {
    width: 28,
    backgroundColor: palette.userChat,
  },
  pressed: {
    opacity: 0.82,
  },
});
