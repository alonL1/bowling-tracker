import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, spacing } from '@/constants/palette';

type GameRowCardProps = {
  title: string;
  scoreLabel: string;
  meta?: string;
  onPress?: () => void;
  onLongPress?: () => void;
};

export default function GameRowCard({
  title,
  scoreLabel,
  meta,
  onPress,
  onLongPress,
}: GameRowCardProps) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={240}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{title}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.score}>{scoreLabel}</Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.9,
  },
  badge: {
    minWidth: 84,
    paddingHorizontal: spacing.md,
    minHeight: 60,
    borderRadius: 14,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
  },
  body: {
    flex: 1,
    gap: 4,
  },
  score: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '400',
  },
  meta: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
  },
});
