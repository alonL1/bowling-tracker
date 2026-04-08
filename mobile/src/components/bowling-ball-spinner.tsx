import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleProp,
  ViewStyle,
} from 'react-native';

import BowlingBallGlyph from '@/components/bowling-ball-glyph';
import { palette } from '@/constants/palette';

type BowlingBallSpinnerProps = {
  size?: number;
  color?: string;
  holeColor?: string;
  style?: StyleProp<ViewStyle>;
};

export default function BowlingBallSpinner({
  size = 28,
  color = palette.spinner,
  holeColor = palette.background,
  style,
}: BowlingBallSpinnerProps) {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        // iOS dev builds on RN 0.83 can emit noisy onAnimatedValueUpdate warnings here.
        useNativeDriver: Platform.OS === 'android',
      }),
    );

    animation.start();

    return () => {
      animation.stop();
      spinValue.stopAnimation();
    };
  }, [spinValue]);

  const rotate = useMemo(
    () =>
      spinValue.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
      }),
    [spinValue],
  );

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate }],
        },
        style,
      ]}>
      <BowlingBallGlyph size={size} color={color} holeColor={holeColor} />
    </Animated.View>
  );
}
