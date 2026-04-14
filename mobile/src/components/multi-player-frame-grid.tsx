import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import SurfaceCard from '@/components/surface-card';
import { palette, radii } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { computeFrameScores, normalizePlayerKey, type ResolvedLivePlayer } from '@/lib/live-session';
import type { LiveFrame } from '@/lib/types';

type MultiPlayerFrameGridProps = {
  players: ResolvedLivePlayer[];
  selectedPlayerKeys?: string[];
  onHorizontalGestureStart?: () => void;
  onHorizontalGestureEnd?: () => void;
};

const BOARD_TEXT_SIZE = 12;
const PLAYER_COLUMN_WEIGHT = 45;
const FRAME_COLUMN_WEIGHTS = [31, 31, 31, 31, 31, 31, 31, 31, 31, 38] as const;
const FRAME_SECTION_WEIGHT = FRAME_COLUMN_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
const TOTAL_COLUMN_WEIGHT = PLAYER_COLUMN_WEIGHT + FRAME_SECTION_WEIGHT;
const FRAME_HEADERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;
const GRID_BORDER_COLOR = '#313744';
const DOUBLE_SPACE = '\u00A0\u00A0';
const SINGLE_SPACE = '\u00A0';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatShotSymbol(pins: number | null) {
  if (pins === null || pins === undefined) {
    return '';
  }
  if (pins === 10) {
    return 'X';
  }
  if (pins === 0) {
    return '-';
  }
  return String(pins);
}

function formatFrameShots(frame: LiveFrame, separator: string) {
  const [shot1, shot2, shot3] = frame.shots;

  if (frame.frame < 10) {
    if (shot1 === 10) {
      return 'X';
    }

    const first = formatShotSymbol(shot1);
    const second =
      shot1 !== null && shot2 !== null && shot1 < 10 && shot1 + shot2 === 10
        ? '/'
        : formatShotSymbol(shot2);
    const parts = [first, second].filter(Boolean);
    return parts.length ? parts.join(separator) : '';
  }

  const parts = [
    shot1 === 10 ? 'X' : formatShotSymbol(shot1),
    shot1 === 10 && shot2 === 10
      ? 'X'
      : shot1 !== null && shot2 !== null && shot1 < 10 && shot1 + shot2 === 10
        ? '/'
        : formatShotSymbol(shot2),
    shot3 === 10 ? 'X' : formatShotSymbol(shot3),
  ].filter(Boolean);

  return parts.length ? parts.join(separator) : '';
}

function buildRunningTotals(frames: LiveFrame[]) {
  const frameScores = computeFrameScores(frames);
  let runningTotal = 0;

  return frameScores.map((score) => {
    if (score === null) {
      return '';
    }
    runningTotal += score;
    return String(runningTotal);
  });
}

function buildColumnWidths(totalWidth: number) {
  const availableWidth = Math.max(0, Math.round(totalWidth) - 2);
  const weights = [PLAYER_COLUMN_WEIGHT, ...FRAME_COLUMN_WEIGHTS];
  const rawWidths = weights.map((weight) => (availableWidth * weight) / TOTAL_COLUMN_WEIGHT);
  const widths = rawWidths.map((value) => Math.floor(value));
  let remaining = availableWidth - widths.reduce((sum, value) => sum + value, 0);

  const fractions = rawWidths
    .map((value, index) => ({
      index,
      fraction: value - widths[index],
    }))
    .sort((left, right) => right.fraction - left.fraction);

  let cursor = 0;
  while (remaining > 0 && fractions.length > 0) {
    widths[fractions[cursor % fractions.length].index] += 1;
    remaining -= 1;
    cursor += 1;
  }

  return {
    player: widths[0],
    frames: widths.slice(1),
    frameSection: widths.slice(1).reduce((sum, value) => sum + value, 0),
  };
}

function buildResponsiveBoardMetrics(columnWidths: ReturnType<typeof buildColumnWidths> | null) {
  const tightestFrameWidth = columnWidths ? Math.min(...columnWidths.frames) : FRAME_COLUMN_WEIGHTS[0];
  const widestFrameWidth = columnWidths ? Math.max(...columnWidths.frames) : FRAME_COLUMN_WEIGHTS[9];
  const scale = clamp((tightestFrameWidth - 13) / 16, 0.72, 1);
  const textSize = Math.round(BOARD_TEXT_SIZE * scale * 10) / 10;
  const lineHeight = Math.max(12, Math.round(textSize * 1.35));

  return {
    textSize,
    lineHeight,
    headerPaddingHorizontal: 0,
    playerPaddingHorizontal: clamp(Math.round((columnWidths?.player ?? PLAYER_COLUMN_WEIGHT) * 0.08), 3, 8),
    shotPaddingHorizontal: 0,
    runningPaddingHorizontal: 0,
    shotSeparator: widestFrameWidth <= 34 || tightestFrameWidth <= 28 ? SINGLE_SPACE : DOUBLE_SPACE,
  };
}

export default function MultiPlayerFrameGrid({
  players,
  selectedPlayerKeys = [],
}: MultiPlayerFrameGridProps) {
  const selectedKeySet = new Set(selectedPlayerKeys.map(normalizePlayerKey));
  const [boardWidth, setBoardWidth] = useState(0);
  const columnWidths = useMemo(
    () => (boardWidth > 0 ? buildColumnWidths(boardWidth) : null),
    [boardWidth],
  );
  const boardMetrics = useMemo(
    () => buildResponsiveBoardMetrics(columnWidths),
    [columnWidths],
  );

  return (
    <View
      onLayout={(event) => {
        const nextWidth = Math.round(event.nativeEvent.layout.width);
        if (!nextWidth || nextWidth === boardWidth) {
          return;
        }
        setBoardWidth(nextWidth);
      }}>
      <SurfaceCard style={styles.surface}>
        <View style={styles.grid}>
        <View style={styles.headerRow}>
          <View
            style={[
              styles.playerHeaderCell,
              { paddingHorizontal: boardMetrics.playerPaddingHorizontal },
              columnWidths
                ? { width: columnWidths.player }
                : { flex: PLAYER_COLUMN_WEIGHT },
            ]}>
            <Text style={[styles.headerText, { fontSize: boardMetrics.textSize, lineHeight: boardMetrics.lineHeight }]}>
              Player
            </Text>
          </View>
          <View
            style={[
              styles.headerFrameSection,
              columnWidths
                ? { width: columnWidths.frameSection }
                : { flex: FRAME_SECTION_WEIGHT },
            ]}>
            {FRAME_HEADERS.map((header, index) => (
              <View
                key={header}
                style={[
                  styles.headerFrameCell,
                  { paddingHorizontal: boardMetrics.headerPaddingHorizontal },
                  columnWidths
                    ? { width: columnWidths.frames[index] }
                    : { flex: FRAME_COLUMN_WEIGHTS[index] },
                  index < FRAME_HEADERS.length - 1 && styles.cellRightDivider,
                ]}>
                  <Text
                    style={[styles.headerText, { fontSize: boardMetrics.textSize, lineHeight: boardMetrics.lineHeight }]}>
                    {header}
                  </Text>
              </View>
            ))}
          </View>
        </View>

        {players.map((player, playerIndex) => {
          const isSelected = selectedKeySet.has(player.playerKey);
          const runningTotals = buildRunningTotals(player.frames);

          return (
            <View
              key={`${player.playerKey}-${player.playerName}`}
              style={[
                styles.playerSection,
                playerIndex < players.length - 1 && styles.playerSectionDivider,
              ]}>
              <View
                style={[
                  styles.playerNameCell,
                  { paddingHorizontal: boardMetrics.playerPaddingHorizontal },
                  columnWidths
                    ? { width: columnWidths.player }
                    : { flex: PLAYER_COLUMN_WEIGHT },
                  isSelected && styles.selectedPlayerNameCell,
                ]}>
                <Text
                  style={[
                    styles.playerNameText,
                    { fontSize: boardMetrics.textSize, lineHeight: boardMetrics.lineHeight },
                    isSelected && styles.selectedPlayerNameText,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail">
                  {player.playerName}
                </Text>
              </View>

              <View
                style={[
                  styles.frameSection,
                  columnWidths
                    ? { width: columnWidths.frameSection }
                    : { flex: FRAME_SECTION_WEIGHT },
                ]}>
                <View style={styles.shotsRow}>
                  {player.frames.map((frame, frameIndex) => (
                    <View
                      key={`${player.playerKey}-shots-${frame.frame}`}
                      style={[
                        styles.shotCell,
                        { paddingHorizontal: boardMetrics.shotPaddingHorizontal },
                        columnWidths
                          ? { width: columnWidths.frames[frameIndex] }
                          : { flex: FRAME_COLUMN_WEIGHTS[frameIndex] },
                        frameIndex < FRAME_HEADERS.length - 1 && styles.cellRightDivider,
                      ]}>
                      <Text
                        style={[
                          styles.boardText,
                          { fontSize: boardMetrics.textSize, lineHeight: boardMetrics.lineHeight },
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="clip"
                        adjustsFontSizeToFit
                        minimumFontScale={0.72}>
                        {formatFrameShots(frame, boardMetrics.shotSeparator) || ' '}
                      </Text>
                    </View>
                  ))}
                </View>

                <View style={styles.runningRow}>
                  {runningTotals.map((runningTotal, frameIndex) => (
                    <View
                      key={`${player.playerKey}-running-${frameIndex + 1}`}
                      style={[
                        styles.runningCell,
                        { paddingHorizontal: boardMetrics.runningPaddingHorizontal },
                        columnWidths
                          ? { width: columnWidths.frames[frameIndex] }
                          : { flex: FRAME_COLUMN_WEIGHTS[frameIndex] },
                        frameIndex < FRAME_HEADERS.length - 1 && styles.cellRightDivider,
                      ]}>
                      <Text
                        style={[
                          styles.boardText,
                          { fontSize: boardMetrics.textSize, lineHeight: boardMetrics.lineHeight },
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="clip"
                        adjustsFontSizeToFit
                        minimumFontScale={0.72}>
                        {runningTotal || ' '}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          );
        })}
        </View>
      </SurfaceCard>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
    borderRadius: radii.lg,
  },
  grid: {
    backgroundColor: palette.surface,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: palette.surfaceRaised,
    borderBottomWidth: 1,
    borderBottomColor: GRID_BORDER_COLOR,
  },
  playerHeaderCell: {
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: GRID_BORDER_COLOR,
    minWidth: 0,
  },
  headerFrameSection: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minWidth: 0,
  },
  headerFrameCell: {
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    minWidth: 0,
  },
  playerSection: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  playerSectionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: GRID_BORDER_COLOR,
  },
  playerNameCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: GRID_BORDER_COLOR,
    minWidth: 0,
  },
  selectedPlayerNameCell: {
    backgroundColor: palette.accent,
  },
  frameSection: {
    flexDirection: 'column',
    alignItems: 'stretch',
    minWidth: 0,
  },
  shotsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minWidth: 0,
  },
  runningRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minWidth: 0,
  },
  shotCell: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    minWidth: 0,
  },
  runningCell: {
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    minWidth: 0,
  },
  cellRightDivider: {
    borderRightWidth: 1,
    borderRightColor: GRID_BORDER_COLOR,
  },
  headerText: {
    color: palette.muted,
    fontSize: BOARD_TEXT_SIZE,
    lineHeight: 17,
    textAlign: 'center',
    fontFamily: fontFamilySans,
  },
  playerNameText: {
    color: palette.text,
    fontSize: BOARD_TEXT_SIZE,
    lineHeight: 17,
    textAlign: 'center',
    fontFamily: fontFamilySans,
    width: '100%',
  },
  selectedPlayerNameText: {
    color: palette.text,
  },
  boardText: {
    color: palette.text,
    fontSize: BOARD_TEXT_SIZE,
    lineHeight: 17,
    textAlign: 'center',
    fontFamily: fontFamilySans,
  },
});
