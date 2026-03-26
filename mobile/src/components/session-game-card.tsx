import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import GameEditSheet from '@/components/game-edit-sheet';
import IconAction from '@/components/icon-action';
import InfoBanner from '@/components/info-banner';
import MultiPlayerFrameGrid from '@/components/multi-player-frame-grid';
import StackBadge from '@/components/stack-badge';
import { deleteGame, queryKeys } from '@/lib/backend';
import { confirmAction } from '@/lib/confirm';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { getResolvedPlayersForGame } from '@/lib/live-session';
import type { GameListItem } from '@/lib/types';

type SessionGameCardProps = {
  game: GameListItem;
  title: string;
  meta: string;
  onRequestMove: (gameId: string) => void;
  onScoreboardGestureStart?: () => void;
  onScoreboardGestureEnd?: () => void;
};

function getCollapsedBadgeLines(title: string) {
  const match = title.match(/^(.*?)(\s+\d+)$/);
  if (!match) {
    return [title];
  }

  return [match[1].trim(), match[2].trim()];
}

export default function SessionGameCard({
  game,
  title,
  meta,
  onRequestMove,
  onScoreboardGestureStart,
  onScoreboardGestureEnd,
}: SessionGameCardProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const deleteMutation = useMutation({
    mutationFn: async () => deleteGame(game.id),
    onSuccess: async () => {
      setDeleteError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.game(game.id) }),
      ]);
    },
    onError: (nextError) => {
      setDeleteError(nextError instanceof Error ? nextError.message : 'Failed to delete game.');
    },
  });

  const scoreLabel = typeof game.total_score === 'number' ? String(game.total_score) : '—';
  const badgeLines = useMemo(() => getCollapsedBadgeLines(title), [title]);
  const scoreboardPlayers = useMemo(
    () =>
      game.scoreboard_extraction
        ? getResolvedPlayersForGame({
            extraction: game.scoreboard_extraction,
          })
        : [],
    [game.scoreboard_extraction],
  );

  const handleDelete = () => {
    confirmAction({
      title: 'Delete game',
      message: 'This will permanently remove the game.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => deleteMutation.mutate(),
    });
  };

  return (
    <>
      <View style={styles.card}>
        <View style={styles.row}>
          <Pressable
            onPress={() => setExpanded((current) => !current)}
            onLongPress={() => onRequestMove(game.id)}
            delayLongPress={240}
            style={({ pressed }) => [styles.summaryPressable, pressed && styles.pressed]}>
            <View style={styles.summary}>
              <StackBadge lines={badgeLines} />
              <View style={styles.scoreBlock}>
                <Text style={styles.scoreValue}>{scoreLabel}</Text>
              </View>
            </View>
          </Pressable>

          <View style={styles.actions}>
            <IconAction
              accessibilityLabel="Edit game"
              onPress={() => setEditOpen(true)}
              icon={<MaterialIcons name="edit" size={22} color={palette.text} />}
            />
            <IconAction
              accessibilityLabel="Delete game"
              onPress={deleteMutation.isPending ? undefined : handleDelete}
              icon={
                deleteMutation.isPending ? (
                  <BowlingBallSpinner size={18} holeColor={palette.field} />
                ) : (
                  <MaterialIcons name="delete" size={22} color={palette.text} />
                )
              }
            />
            <IconAction
              accessibilityLabel={expanded ? 'Collapse game' : 'Expand game'}
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
            <Text style={styles.metaLine}>{meta}</Text>
            {game.scoreboard_extraction ? (
              <MultiPlayerFrameGrid
                players={scoreboardPlayers}
                selectedPlayerKeys={game.selected_self_player_key ? [game.selected_self_player_key] : []}
                onHorizontalGestureStart={onScoreboardGestureStart}
                onHorizontalGestureEnd={onScoreboardGestureEnd}
              />
            ) : (
              <Text style={styles.loadingText}>No scoreboard data available for this game.</Text>
            )}

            {deleteError ? <InfoBanner tone="error" text={deleteError} /> : null}
          </View>
        ) : null}
      </View>

      <GameEditSheet visible={editOpen} game={game} onClose={() => setEditOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 2,
    paddingVertical: 6,
    gap: 10,
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
  metaLine: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 19,
    fontFamily: fontFamilySans,
    paddingLeft: 0,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  expandedBody: {
    gap: 8,
    paddingLeft: 6,
  },
  loadingText: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  pressed: {
    opacity: 0.92,
  },
});
