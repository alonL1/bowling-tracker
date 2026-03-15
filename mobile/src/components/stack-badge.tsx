import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

type StackBadgeProps = {
  lines: string[];
  compact?: boolean;
  horizontal?: boolean;
  style?: StyleProp<ViewStyle>;
  lineStyle?: StyleProp<TextStyle>;
};

export default function StackBadge({
  lines,
  compact = false,
  horizontal = false,
  style,
  lineStyle,
}: StackBadgeProps) {
  return (
    <View
      style={[
        styles.base,
        compact && styles.compact,
        horizontal && styles.horizontal,
        style,
      ]}>
      {lines.map((line, index) => (
        <Text key={`${line}-${index}`} style={[styles.line, compact && styles.compactLine, lineStyle]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: 52,
    width: 52,
    minHeight: 52,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 5,
  },
  compact: {
    width: undefined,
    minWidth: 0,
    height: undefined,
    minHeight: 30,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.md,
  },
  horizontal: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  line: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '400',
    textAlign: 'center',
    fontFamily: fontFamilySans,
  },
  compactLine: {
    lineHeight: 16,
  },
});
