import AntDesign from '@expo/vector-icons/AntDesign';
import Entypo from '@expo/vector-icons/Entypo';
import Feather from '@expo/vector-icons/Feather';
import Fontisto from '@expo/vector-icons/Fontisto';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
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
import SurfaceCard from '@/components/surface-card';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { DEFAULT_POST_AUTH_PATH, getSafePostAuthPath } from '@/lib/onboarding';
import { useAuth } from '@/providers/auth-provider';

type TutorialCard = {
  key: string;
  title: string;
  body: string;
};

const CARD_COUNT = 4;

export default function GettingStartedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string; replay?: string }>();
  const { user, loading, isGuest, tutorialSeen, markTutorialSeen } = useAuth();
  const nextPath = useMemo(() => getSafePostAuthPath(params.next), [params.next]);
  const replay = params.replay === '1';
  const pagerRef = useRef<ScrollView | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pagerWidth = Math.max(0, Math.round(windowWidth - insets.left - insets.right));

  const cards = useMemo<TutorialCard[]>(
    () => [
      {
        key: 'intro',
        title: 'Welcome to PinPoint',
        body: 'A fast, modern way to turn scoreboard photos into clean bowling logs you can actually use.',
      },
      {
        key: 'record',
        title: 'Pick the logging flow that fits today',
        body: 'Use Live Session while you bowl, Upload Session after you finish, or Add Multiple Sessions when you have a big batch to sort.',
      },
      {
        key: 'review',
        title: 'Review before you save',
        body: 'PinPoint extracts the names and scores for you. Choose which player is you, then fix anything that looks off before it is logged.',
      },
      {
        key: 'explore',
        title: 'Use your data after it is logged',
        body: isGuest
          ? 'Browse your Sessions, ask Chat anything about your bowling data, and create an account later to sync your history and unlock Friends.'
          : 'Browse your Sessions, compare stats on Friends, and use Chat to ask almost anything about your bowling data.',
      },
    ],
    [isGuest],
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

  if (!user || (tutorialSeen && !replay)) {
    return <CenteredState title="Loading account..." loading />;
  }

  const finishTutorial = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await markTutorialSeen();
      router.replace(nextPath as Href);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to finish the tutorial.');
      setBusy(false);
    }
  };

  const handleNext = () => {
    if (pageIndex === CARD_COUNT - 1) {
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
      <View style={styles.page}>
        <View style={styles.topBar}>
          <Text style={styles.topLabel}>{replay ? 'TUTORIAL' : 'GETTING STARTED'}</Text>
          <Pressable
            onPress={() => void finishTutorial()}
            disabled={busy}
            style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}>
            <Text style={styles.skipText}>Skip</Text>
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
              <View key={card.key} style={[styles.slide, pagerWidth ? { width: pagerWidth } : null]}>
                <SurfaceCard style={styles.slideCard} tone="raised">
                  {index === 0 ? (
                    <View style={styles.heroRow}>
                      <View style={styles.heroTextBlock}>
                        <Text style={styles.cardTitle}>{card.title}</Text>
                        <Text style={styles.cardBody}>{card.body}</Text>
                      </View>
                      <Image
                        source={require('../../assets/pins/happy_pin.png')}
                        style={styles.heroPin}
                        resizeMode="contain"
                      />
                    </View>
                  ) : null}

                  {index === 1 ? (
                    <>
                      <Text style={styles.cardTitle}>{card.title}</Text>
                      <Text style={styles.cardBody}>{card.body}</Text>
                      <View style={styles.featureList}>
                        <FeatureRow
                          icon={<Fontisto name="radio-btn-active" size={18} color={palette.text} />}
                          title="Live Session"
                          body="Use this while you are bowling and add each scoreboard as you go."
                        />
                        <FeatureRow
                          icon={<Feather name="upload" size={18} color={palette.text} />}
                          title="Upload Session"
                          body="Use this after a session when all the games belong together."
                        />
                        <FeatureRow
                          icon={<MaterialCommunityIcons name="card-multiple" size={20} color={palette.text} />}
                          title="Add Multiple Sessions"
                          body="Use this when you have a big batch and want PinPoint to sort them for you."
                        />
                      </View>
                    </>
                  ) : null}

                  {index === 2 ? (
                    <>
                      <Text style={styles.cardTitle}>{card.title}</Text>
                      <Text style={styles.cardBody}>{card.body}</Text>
                      <SurfaceCard style={styles.sampleCard}>
                        <View style={styles.sampleHeader}>
                          <Text style={styles.sampleTitle}>Extracted scoreboard</Text>
                          <AntDesign name="check-circle" size={16} color={palette.userChat} />
                        </View>
                        <View style={styles.sampleList}>
                          <SamplePlayerRow name="Alon" score="214" active />
                          <SamplePlayerRow name="Sam" score="179" />
                          <SamplePlayerRow name="Chris" score="168" />
                        </View>
                      </SurfaceCard>
                      <View style={styles.featureList}>
                        <FeatureRow
                          icon={<Ionicons name="person" size={18} color={palette.text} />}
                          title="Choose yourself"
                          body="Mark which player on the scoreboard is you before you log the game."
                        />
                        <FeatureRow
                          icon={<Entypo name="pencil" size={18} color={palette.text} />}
                          title="Edit if needed"
                          body="Fix totals, player names, or anything else that does not look right."
                        />
                      </View>
                    </>
                  ) : null}

                  {index === 3 ? (
                    <>
                      <Text style={styles.cardTitle}>{card.title}</Text>
                      <Text style={styles.cardBody}>{card.body}</Text>
                      <View style={styles.featureList}>
                        <FeatureRow
                          icon={<MaterialCommunityIcons name="book-open-page-variant" size={20} color={palette.text} />}
                          title="Sessions"
                          body="Your log of every session and game you have saved."
                        />
                        <FeatureRow
                          icon={<Ionicons name="people" size={18} color={palette.text} />}
                          title="Friends"
                          body={
                            isGuest
                              ? 'Create an account later to compare stats and invite friends.'
                              : 'Compare stats and see how your bowling stacks up.'
                          }
                        />
                        <FeatureRow
                          icon={<Ionicons name="chatbubble-ellipses" size={18} color={palette.text} />}
                          title="Chat"
                          body="Ask almost anything about your bowling data and get answers based on your history."
                        />
                      </View>
                    </>
                  ) : null}
                </SurfaceCard>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.dotsRow}>
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
                index === pageIndex && styles.dotActive,
              ]}
            />
          ))}
        </View>

        {error ? <InfoBanner text={error} tone="error" /> : null}

        <ActionButton
          label={pageIndex === cards.length - 1 ? 'Get Started' : 'Next'}
          onPress={handleNext}
          loading={busy}
          disabled={busy}
        />
      </View>
    </SafeAreaView>
  );
}

function FeatureRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIcon}>{icon}</View>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureBody}>{body}</Text>
      </View>
    </View>
  );
}

function SamplePlayerRow({
  name,
  score,
  active = false,
}: {
  name: string;
  score: string;
  active?: boolean;
}) {
  return (
    <View style={[styles.sampleRow, active && styles.sampleRowActive]}>
      <View>
        <Text style={styles.sampleName}>{name}</Text>
        <Text style={styles.sampleSubtext}>{active ? 'Selected as you' : 'Detected player'}</Text>
      </View>
      <Text style={styles.sampleScore}>{score}</Text>
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
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroTextBlock: {
    flex: 1,
    gap: spacing.sm,
  },
  heroPin: {
    width: 110,
    height: 110,
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
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  featureText: {
    flex: 1,
    gap: spacing.xs,
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
  sampleCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  sampleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sampleTitle: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  sampleList: {
    gap: spacing.sm,
  },
  sampleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: palette.surfaceRaised,
  },
  sampleRowActive: {
    borderWidth: 1,
    borderColor: palette.userChat,
  },
  sampleName: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  sampleSubtext: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  sampleScore: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
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
