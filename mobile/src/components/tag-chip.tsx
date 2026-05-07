import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import type { GameTag } from '@/lib/types';

type TagChipMode = 'display' | 'add' | 'selected';

type TagChipProps = {
  tag: GameTag;
  mode?: TagChipMode;
  onPress?: () => void;
  disabled?: boolean;
};

function getChipLabel(tag: GameTag, mode: TagChipMode) {
  if (mode === 'add') {
    return `+ ${tag}`;
  }
  if (mode === 'selected') {
    return `✓ ${tag}`;
  }
  return tag;
}

export default function TagChip({
  tag,
  mode = 'display',
  onPress,
  disabled = false,
}: TagChipProps) {
  const pressableDisabled = disabled || !onPress;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `Toggle ${tag} tag` : `${tag} tag`}
      disabled={pressableDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        mode === 'add' && styles.chipAdd,
        mode === 'selected' && styles.chipSelected,
        pressableDisabled && onPress && styles.chipDisabled,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.label, mode === 'add' && styles.labelAdd]}>
        {getChipLabel(tag, mode)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 22,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chipAdd: {
    opacity: 0.55,
  },
  chipSelected: {
    backgroundColor: palette.accent,
  },
  chipDisabled: {
    opacity: 0.45,
  },
  label: {
    color: palette.text,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  labelAdd: {
    color: palette.muted,
  },
  pressed: {
    opacity: 0.82,
  },
});
