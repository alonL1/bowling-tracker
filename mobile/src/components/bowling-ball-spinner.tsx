import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

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
        useNativeDriver: Platform.OS !== 'web',
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

  const holeSize = Math.max(3, Math.round(size * 0.14));

  return (
    <Animated.View
      style={[
        styles.ball,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          transform: [{ rotate }],
        },
        style,
      ]}>
      <View
        style={[
          styles.hole,
          {
            width: holeSize,
            height: holeSize,
            borderRadius: holeSize / 2,
            backgroundColor: holeColor,
            left: '35%',
            top: '22%',
          },
        ]}
      />
      <View
        style={[
          styles.hole,
          {
            width: holeSize,
            height: holeSize,
            borderRadius: holeSize / 2,
            backgroundColor: holeColor,
            left: '54%',
            top: '18%',
          },
        ]}
      />
      <View
        style={[
          styles.hole,
          {
            width: holeSize,
            height: holeSize,
            borderRadius: holeSize / 2,
            backgroundColor: holeColor,
            left: '45%',
            top: '38%',
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ball: {
    position: 'relative',
  },
  hole: {
    position: 'absolute',
  },
});
