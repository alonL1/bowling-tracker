import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette, radii } from '@/constants/palette';

type IconActionProps = {
  icon: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
};

export default function IconAction({
  icon,
  onPress,
  onLongPress,
  accessibilityLabel,
  style,
}: IconActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, style]}>
      <View style={styles.iconWrap}>{icon}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.82,
    backgroundColor: palette.surfaceRaised,
  },
});
