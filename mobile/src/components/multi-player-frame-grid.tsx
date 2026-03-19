import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import SurfaceCard from '@/components/surface-card';
import { palette, radii } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { formatFrameCell, normalizePlayerKey, type ResolvedLivePlayer } from '@/lib/live-session';

type MultiPlayerFrameGridProps = {
  players: ResolvedLivePlayer[];
  selectedPlayerKeys?: string[];
  onHorizontalGestureStart?: () => void;
  onHorizontalGestureEnd?: () => void;
};

const FRAME_HEADERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Total'];

export default function MultiPlayerFrameGrid({
  players,
  selectedPlayerKeys = [],
  onHorizontalGestureStart,
  onHorizontalGestureEnd,
}: MultiPlayerFrameGridProps) {
  const selectedKeySet = new Set(selectedPlayerKeys.map(normalizePlayerKey));

  return (
    <SurfaceCard style={styles.surface}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        onTouchStart={onHorizontalGestureStart}
        onTouchEnd={onHorizontalGestureEnd}
        onTouchCancel={onHorizontalGestureEnd}
        onScrollBeginDrag={onHorizontalGestureStart}
        onScrollEndDrag={onHorizontalGestureEnd}
        onMomentumScrollEnd={onHorizontalGestureEnd}>
        <View style={styles.grid}>
          <View style={[styles.row, styles.headerRow]}>
            <View style={[styles.nameCell, styles.headerNameCell]}>
              <Text style={styles.headerText}>Player</Text>
            </View>
            {FRAME_HEADERS.map((header, index) => (
              <View
                key={header}
                style={[
                  styles.frameCell,
                  index === FRAME_HEADERS.length - 1 && styles.totalCell,
                ]}>
                <Text style={styles.headerText}>{header}</Text>
              </View>
            ))}
          </View>

          {players.map((player) => {
            const isSelected = selectedKeySet.has(player.playerKey);
            return (
              <View key={`${player.playerKey}-${player.playerName}`} style={styles.row}>
                <View style={[styles.nameCell, isSelected && styles.selectedNameCell]}>
                  <Text
                    style={[styles.nameText, isSelected && styles.selectedNameText]}
                    numberOfLines={1}>
                    {player.playerName}
                  </Text>
                </View>
                {player.frames.map((frame) => (
                  <View key={`${player.playerKey}-${frame.frame}`} style={styles.frameCell}>
                    <Text style={styles.cellText}>{formatFrameCell(frame)}</Text>
                  </View>
                ))}
                <View style={[styles.frameCell, styles.totalCell]}>
                  <Text style={[styles.cellText, styles.totalText]}>
                    {typeof player.totalScore === 'number' ? player.totalScore : '—'}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
    borderRadius: radii.lg,
  },
  grid: {
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: '#313744',
    backgroundColor: palette.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  headerRow: {
    backgroundColor: palette.surfaceRaised,
  },
  nameCell: {
    width: 122,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#313744',
  },
  headerNameCell: {
    backgroundColor: palette.surfaceRaised,
  },
  selectedNameCell: {
    backgroundColor: palette.accent,
  },
  frameCell: {
    width: 56,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#313744',
  },
  totalCell: {
    width: 68,
  },
  headerText: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamilySans,
  },
  nameText: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  selectedNameText: {
    color: palette.text,
  },
  cellText: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
    fontFamily: fontFamilySans,
  },
  totalText: {
    fontWeight: '700',
  },
});
