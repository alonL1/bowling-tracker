import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import SurfaceCard from '@/components/surface-card';
import { palette, radii } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import type { FrameGridCell } from '@/lib/bowling';

export default function FrameGrid({ frames }: { frames: FrameGridCell[] }) {
  return (
    <SurfaceCard style={styles.surface}>
      <View style={styles.grid}>
      {frames.map((frame) => (
        <View
          key={frame.frameNumber}
          style={[styles.frame, frame.frameNumber === 10 && styles.frameTenth]}>
          <Text style={styles.frameNumber}>{frame.frameNumber}</Text>
          <View style={styles.shotsRow}>
            {frame.shots.map((shot, index) => (
              <Text
                key={`${frame.frameNumber}-${index}`}
                style={[
                  styles.shotCell,
                  index < frame.shots.length - 1 && styles.shotCellBorder,
                  frame.frameNumber === 10 && styles.tenthShotCell,
                ]}>
                {shot || ' '}
              </Text>
            ))}
          </View>
          <Text style={styles.running}>{frame.running || ' '}</Text>
        </View>
      ))}
      </View>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  surface: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  grid: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: '#313744',
  },
  frame: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: '#313744',
    backgroundColor: palette.surface,
  },
  frameTenth: {
    flex: 1.36,
    borderRightWidth: 0,
  },
  frameNumber: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderColor: '#313744',
    fontFamily: fontFamilySans,
  },
  shotsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderColor: '#313744',
  },
  shotCell: {
    flex: 1,
    color: palette.text,
    fontSize: 17,
    lineHeight: 22,
    textAlign: 'center',
    paddingVertical: 7,
    fontFamily: fontFamilySans,
  },
  tenthShotCell: {
    fontSize: 17,
  },
  shotCellBorder: {
    borderRightWidth: 1,
    borderColor: '#313744',
  },
  running: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: 7,
    fontFamily: fontFamilySans,
  },
});
