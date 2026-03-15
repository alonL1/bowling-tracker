import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

type CenteredStateProps = {
  title: string;
  subtitle?: string;
  loading?: boolean;
};

export default function CenteredState({
  title,
  subtitle,
  loading = false,
}: CenteredStateProps) {
  return (
    <View style={styles.container}>
      {loading ? <BowlingBallSpinner size={46} /> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    backgroundColor: palette.background,
  },
  title: {
    color: palette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: fontFamilySans,
    textAlign: 'center',
  },
  subtitle: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
    textAlign: 'center',
    maxWidth: 420,
  },
});
