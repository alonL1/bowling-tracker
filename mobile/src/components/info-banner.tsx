import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import SurfaceCard from '@/components/surface-card';

type InfoBannerProps = {
  text: string;
  tone?: 'default' | 'error';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export default function InfoBanner({
  text,
  tone = 'default',
  style,
  textStyle,
}: InfoBannerProps) {
  return (
    <SurfaceCard style={[styles.banner, tone === 'error' && styles.errorBanner, style]}>
      <Text style={[styles.text, tone === 'error' && styles.errorText, textStyle]}>{text}</Text>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
  },
  errorBanner: {
    backgroundColor: palette.danger,
  },
  text: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  errorText: {
    color: palette.text,
  },
});
