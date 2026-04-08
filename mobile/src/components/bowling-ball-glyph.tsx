import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type BowlingBallGlyphProps = {
  size: number;
  color: string;
  holeColor: string;
  style?: StyleProp<ViewStyle>;
};

export default function BowlingBallGlyph({
  size,
  color,
  holeColor,
  style,
}: BowlingBallGlyphProps) {
  const holeSize = Math.max(3, Math.round(size * 0.14));

  return (
    <View
      style={[
        styles.ball,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
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
    </View>
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
