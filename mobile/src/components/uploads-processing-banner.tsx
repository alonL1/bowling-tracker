import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import SurfaceCard from '@/components/surface-card';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import type { UploadsProcessingFlow } from '@/lib/uploads-processing-store';
import { useUploadsProcessing } from '@/providers/uploads-processing-provider';
import { getUploadsProcessingSummaryForScope } from '@/lib/uploads-processing-store';

type UploadsProcessingBannerProps = {
  showPending?: boolean;
  sourceFlow?: UploadsProcessingFlow;
  sessionIds?: Array<string | null | undefined>;
};

export default function UploadsProcessingBanner({
  showPending = true,
  sourceFlow,
  sessionIds,
}: UploadsProcessingBannerProps) {
  const router = useRouter();
  const { store, summary } = useUploadsProcessing();
  const scopedSummary =
    sourceFlow || sessionIds?.length
      ? getUploadsProcessingSummaryForScope(store, { sourceFlow, sessionIds })
      : summary;
  const visiblePendingCount = showPending ? scopedSummary.pendingCount : 0;

  if (visiblePendingCount === 0 && scopedSummary.failedCount === 0) {
    return null;
  }

  const detailText =
    scopedSummary.failedCount > 0
      ? `${scopedSummary.failedCount} item${scopedSummary.failedCount === 1 ? '' : 's'} need attention.`
      : `${visiblePendingCount} item${visiblePendingCount === 1 ? '' : 's'} still syncing in the background.`;
  const helperText =
    scopedSummary.failedCount > 0
      ? 'Open Uploads & Processing to retry or delete failed scoreboards.'
      : 'Open Uploads & Processing to monitor background uploads and finalization.';

  return (
    <Pressable
      onPress={() => router.push('/uploads-processing' as never)}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
      <SurfaceCard style={styles.card} tone="raised">
        <View style={styles.textBlock}>
          <Text style={styles.title}>Uploads & Processing</Text>
          <Text style={styles.detail}>{detailText}</Text>
          <Text style={styles.helper}>{helperText}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={palette.muted} />
      </SurfaceCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 0,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  textBlock: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  detail: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  helper: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  pressed: {
    opacity: 0.94,
  },
});
