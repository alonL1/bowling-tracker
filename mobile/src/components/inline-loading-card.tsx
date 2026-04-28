import React from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import SurfaceCard from '@/components/surface-card';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

type InlineLoadingCardProps = {
  label: string;
  style?: StyleProp<ViewStyle>;
};

export default function InlineLoadingCard({ label, style }: InlineLoadingCardProps) {
  return (
    <SurfaceCard style={[styles.card, style]}>
      <BowlingBallSpinner size={24} holeColor={palette.surface} />
      <Text style={styles.text}>{label}</Text>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  text: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
});
