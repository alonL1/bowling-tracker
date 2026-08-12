import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  AppState,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { palette, radii } from '@/constants/palette';
import {
  getProcessingEstimate,
  loadProcessingDurations,
  PROCESSING_DEBUG,
  subscribeToProcessingEstimate,
} from '@/lib/processing-duration-store';
import {
  getPendingScoreboardLabel,
  type PendingScoreboardPhase,
} from '@/lib/pending-scoreboard';
import { ensureProcessingAnchor, getProcessingElapsedMs } from '@/lib/processing-progress';

const TRACK_HEIGHT = 10;
// The bar never completes on a timer — only the real `ready` transition ends it,
// and that unmounts the whole pending card. So it eases to FAST_TARGET over the
// estimate, then crawls, so an overrunning job still looks alive.
const FAST_TARGET = 0.9;
const CRAWL_TARGET = 0.985;
const CRAWL_MS = 120_000;

function easeOutQuad(t: number) {
  return 1 - (1 - t) * (1 - t);
}

type ProcessingProgressBarProps = {
  gameId: string;
  scope: string;
  queuePosition: number;
};

function ProcessingProgressBar({ gameId, scope, queuePosition }: ProcessingProgressBarProps) {
  const [estimateMs, setEstimateMs] = useState(() => getProcessingEstimate().estimateMs);
  const trackWidth = useSharedValue(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    void loadProcessingDurations();
    return subscribeToProcessingEstimate((estimate) => setEstimateMs(estimate.estimateMs));
  }, []);

  const start = useCallback(() => {
    const elapsed = getProcessingElapsedMs(gameId);
    const seed = FAST_TARGET * easeOutQuad(Math.min(1, elapsed / Math.max(1, estimateMs)));
    const remaining = Math.max(0, estimateMs - elapsed);

    // Seeding the value and assigning the sequence from JS would be two separate
    // UI-thread dispatches with no ordering guarantee; one worklet is atomic.
    runOnUI((seedValue: number, remainingMs: number) => {
      'worklet';
      cancelAnimation(progress);
      progress.value = seedValue;
      progress.value = withSequence(
        withTiming(FAST_TARGET, { duration: remainingMs, easing: Easing.out(Easing.quad) }),
        withTiming(CRAWL_TARGET, { duration: CRAWL_MS, easing: Easing.linear }),
      );
    })(seed, remaining);
  }, [estimateMs, gameId, progress]);

  useEffect(() => {
    // Anchored on the first render of the processing phase rather than on a
    // server timestamp: `created_at` is when the row was inserted (the start of
    // the queue wait) and `updated_at` is re-stamped on every status write.
    // Idempotent, so a remounted bar resumes at real elapsed time.
    ensureProcessingAnchor(scope, gameId, queuePosition);
    start();
    // Reanimated advances on the UI-thread frame clock, which stops while
    // backgrounded. Without this the bar comes back behind real elapsed time.
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        start();
      }
    });
    return () => subscription.remove();
    // queuePosition intentionally omitted: it only seeds a new anchor, and
    // re-running on every poll would restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, scope, start]);

  const handleTrackLayout = useCallback(
    (event: LayoutChangeEvent) => {
      trackWidth.value = event.nativeEvent.layout.width;
    },
    [trackWidth],
  );

  // Animating width in px rather than a percentage string (a layout write per
  // frame) or scaleX (which would squash the pill cap into an ellipse).
  const fillStyle = useAnimatedStyle(() => ({
    width: Math.max(TRACK_HEIGHT, trackWidth.value * progress.value),
  }));

  return (
    <View
      style={styles.track}
      onLayout={handleTrackLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.fill, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
    // Matches the BowlingBallSpinner on the same row. palette.accent would be
    // darker than the track and read as a hole rather than progress.
    backgroundColor: palette.spinner,
  },
});

export default memo(ProcessingProgressBar);

type PendingScoreboardTitleProps = {
  phase: PendingScoreboardPhase;
  gameId: string;
  style?: StyleProp<TextStyle>;
};

// The pending card's title. While PROCESSING_DEBUG is on it also carries the
// live elapsed time against the current estimate, appended to the label rather
// than added as a second line — an extra row would shift the layout offsets the
// screens measure for scroll-to-game.
export function PendingScoreboardTitle({ phase, gameId, style }: PendingScoreboardTitleProps) {
  const showDebug = PROCESSING_DEBUG && phase === 'processing';
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!showDebug) {
      return;
    }
    // The only per-tick JS in this feature, and it disappears with the flag.
    const interval = setInterval(() => forceTick((tick) => tick + 1), 1000);
    return () => clearInterval(interval);
  }, [showDebug]);

  const label = getPendingScoreboardLabel(phase);
  if (!showDebug) {
    return <Text style={style}>{label}</Text>;
  }

  const elapsedSeconds = (getProcessingElapsedMs(gameId) / 1000).toFixed(1);
  const estimate = getProcessingEstimate();
  const estimateSeconds = (estimate.estimateMs / 1000).toFixed(1);

  return (
    <Text style={style}>
      {`${label} · ${elapsedSeconds}s / ${estimateSeconds}s ${estimate.source === 'seed' ? 'seed' : 'med'}`}
    </Text>
  );
}
