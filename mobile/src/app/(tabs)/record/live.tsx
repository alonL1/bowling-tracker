import React from 'react';
import { Text, StyleSheet } from 'react-native';

import DetailShell from '@/components/detail-shell';
import SurfaceCard from '@/components/surface-card';
import { palette, spacing } from '@/constants/palette';

export default function LiveSessionScreen() {
  return (
    <DetailShell title="Live Session" subtitle="Live sessions coming soon...">
      <SurfaceCard style={styles.card}>
        <Text style={styles.text}>This stays as a placeholder until the live session feature is real on mobile.</Text>
      </SurfaceCard>
    </DetailShell>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  text: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
  },
});
