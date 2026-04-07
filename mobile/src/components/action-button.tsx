import React, { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import { palette, radii } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

type ActionButtonProps = {
  label: string;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  leftIcon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export default function ActionButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  leftIcon,
  style,
  textStyle,
}: ActionButtonProps) {
  const isDisabled = disabled || loading;
  const spinnerHoleColor =
    variant === 'secondary'
      ? palette.surfaceRaised
      : variant === 'danger'
        ? palette.danger
        : palette.accent;
  const icon =
    loading ? (
      <BowlingBallSpinner
        size={18}
        holeColor={spinnerHoleColor}
      />
    ) : (
      leftIcon
    );

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.secondaryButton,
        variant === 'danger' && styles.dangerButton,
        isDisabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}>
      <View style={styles.content}>
        {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
        <Text
          style={[
            styles.text,
            variant === 'secondary' && styles.secondaryText,
            textStyle,
          ]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radii.md,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  secondaryButton: {
    backgroundColor: palette.surfaceRaised,
  },
  dangerButton: {
    backgroundColor: palette.danger,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  secondaryText: {
    color: palette.text,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.52,
  },
  pressed: {
    opacity: 0.9,
  },
});
