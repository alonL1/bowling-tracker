import React, { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette, radii } from '@/constants/palette';

type SurfaceCardProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'raised';
};

export default function SurfaceCard({
  children,
  style,
  tone = 'default',
}: SurfaceCardProps) {
  return <View style={[styles.card, tone === 'raised' && styles.raised, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
  },
  raised: {
    backgroundColor: palette.surfaceRaised,
  },
});
