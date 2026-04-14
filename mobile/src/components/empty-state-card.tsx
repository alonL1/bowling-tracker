import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import ActionButton from '@/components/action-button';
import SurfaceCard from '@/components/surface-card';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

type EmptyStateCardProps = {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'default' | 'raised';
};

export default function EmptyStateCard({
  title,
  body,
  actionLabel,
  onAction,
  tone = 'default',
}: EmptyStateCardProps) {
  return (
    <SurfaceCard style={styles.card} tone={tone}>
      <View style={styles.textBlock}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      {actionLabel && onAction ? (
        <ActionButton label={actionLabel} onPress={onAction} variant="secondary" />
      ) : null}
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  textBlock: {
    gap: spacing.xs,
  },
  title: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  body: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
});
