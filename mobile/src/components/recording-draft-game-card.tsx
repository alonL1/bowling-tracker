import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import IconAction from '@/components/icon-action';
import MultiPlayerFrameGrid from '@/components/multi-player-frame-grid';
import StackBadge from '@/components/stack-badge';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { confirmAction } from '@/lib/confirm';
import { getLiveGameScoreLabel, getResolvedPlayersForGame } from '@/lib/live-session';
import type { RecordingDraftGame } from '@/lib/types';

type RecordingDraftGameCardProps = {
  game: RecordingDraftGame;
  gameNumber: number;
  selectedPlayerKeys: string[];
  onEdit: (game: RecordingDraftGame) => void;
  onDelete: (gameId: string) => void;
  deleting?: boolean;
  onStartDrag?: () => void;
  dragActive?: boolean;
};

function formatCapturedAt(value?: string | null) {
  if (!value) {
    return 'Scoreboard captured';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Scoreboard captured';
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function RecordingDraftGameCard({
  game,
  gameNumber,
  selectedPlayerKeys,
  onEdit,
  onDelete,
  deleting = false,
  onStartDrag,
  dragActive = false,
}: RecordingDraftGameCardProps) {
  const [expanded, setExpanded] = useState(false);
  const players = useMemo(() => getResolvedPlayersForGame(game), [game]);
  const badgeLines = useMemo(() => ['Game', String(gameNumber)], [gameNumber]);
  const scoreLabel = useMemo(
    () => getLiveGameScoreLabel(game, selectedPlayerKeys),
    [game, selectedPlayerKeys],
  );

  return (
    <View style={[styles.card, dragActive && styles.cardActive]}>
      <View style={styles.row}>
        <Pressable
          onPress={() => setExpanded((current) => !current)}
          style={({ pressed }) => [styles.summaryPressable, pressed && styles.pressed]}>
          <View style={styles.summary}>
            <StackBadge lines={badgeLines} />
            <View style={styles.scoreBlock}>
              <Text style={styles.scoreValue}>{scoreLabel}</Text>
            </View>
          </View>
        </Pressable>

        <View style={styles.actions}>
          {onStartDrag ? (
            <Pressable
              accessibilityLabel="Reorder draft game"
              delayLongPress={140}
              onLongPress={onStartDrag}
              style={({ pressed }) => [styles.dragHandleButton, pressed && styles.pressed]}>
              <MaterialIcons name="drag-indicator" size={22} color={palette.muted} />
            </Pressable>
          ) : null}
          <IconAction
            accessibilityLabel="Edit draft game"
            onPress={() => onEdit(game)}
            icon={<MaterialIcons name="edit" size={22} color={palette.text} />}
          />
          <IconAction
            accessibilityLabel="Delete draft game"
            onPress={() =>
              confirmAction({
                title: 'Delete game',
                message: 'Remove this scoreboard from the draft?',
                confirmLabel: 'Delete',
                destructive: true,
                onConfirm: () => onDelete(game.id),
              })
            }
            icon={
              deleting ? (
                <BowlingBallSpinner size={18} holeColor={palette.field} />
              ) : (
                <MaterialIcons name="delete" size={22} color={palette.text} />
              )
            }
          />
          <IconAction
            accessibilityLabel={expanded ? 'Collapse draft game' : 'Expand draft game'}
            onPress={() => setExpanded((current) => !current)}
            icon={
              <Ionicons
                name={expanded ? 'chevron-down' : 'chevron-forward'}
                size={22}
                color={palette.text}
              />
            }
          />
        </View>
      </View>

      {expanded ? (
        <View style={styles.expandedBody}>
          <Text style={styles.metaLine}>{formatCapturedAt(game.captured_at || game.captured_at_hint)}</Text>
          <MultiPlayerFrameGrid players={players} selectedPlayerKeys={selectedPlayerKeys} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 2,
    paddingVertical: 6,
    gap: 10,
  },
  cardActive: {
    opacity: 0.95,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryPressable: {
    flex: 1,
    minWidth: 0,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minWidth: 0,
    paddingLeft: 6,
  },
  scoreBlock: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    justifyContent: 'center',
  },
  scoreValue: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  dragHandleButton: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedBody: {
    gap: 8,
    paddingLeft: 6,
  },
  metaLine: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  pressed: {
    opacity: 0.92,
  },
});
