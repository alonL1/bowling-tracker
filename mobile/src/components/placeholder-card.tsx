import React, { type ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';

import SurfaceCard from '@/components/surface-card';
import { palette, spacing } from '@/constants/palette';

type PlaceholderCardProps = {
  title: string;
  description?: string;
  children?: ReactNode;
};

export default function PlaceholderCard({
  title,
  description,
  children,
}: PlaceholderCardProps) {
  return (
    <SurfaceCard style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children}
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '600',
  },
  description: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 22,
  },
});
