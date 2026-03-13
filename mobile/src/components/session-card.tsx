import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import StackBadge from '@/components/stack-badge';
import SurfaceCard from '@/components/surface-card';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import type { SessionGroup } from '@/lib/bowling';

type SessionCardProps = {
  session: SessionGroup;
  onPress?: () => void;
};

export default function SessionCard({ session, onPress }: SessionCardProps) {
  const gameLabel = session.gameCount === 1 ? 'game' : 'games';

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
      <SurfaceCard style={styles.card}>
        <StackBadge lines={[session.dateMonth, session.dateDay]} />
        <View style={styles.textBlock}>
          <Text style={styles.title}>{session.title}</Text>
          <Text style={styles.meta}>
            {session.gameCount} {gameLabel} | Avg {session.averageLabel}
          </Text>
        </View>
      </SurfaceCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 0,
  },
  card: {
    minHeight: 74,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  pressed: {
    opacity: 0.94,
  },
  textBlock: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  title: {
    color: palette.text,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '400',
    fontFamily: fontFamilySans,
  },
  meta: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
});
