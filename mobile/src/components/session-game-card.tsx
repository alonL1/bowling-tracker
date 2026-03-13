import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import FrameGrid from '@/components/frame-grid';
import GameEditSheet from '@/components/game-edit-sheet';
import IconAction from '@/components/icon-action';
import InfoBanner from '@/components/info-banner';
import StackBadge from '@/components/stack-badge';
import { deleteGame, fetchGameById, queryKeys } from '@/lib/backend';
import { buildFrameGrid } from '@/lib/bowling';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import type { GameListItem } from '@/lib/types';

type SessionGameCardProps = {
  game: GameListItem;
  title: string;
  meta: string;
  onRequestMove: (gameId: string) => void;
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
}: SessionGameCardProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const gameQuery = useQuery({
    queryKey: queryKeys.game(game.id),
    queryFn: () => fetchGameById(game.id),
    enabled: expanded,
  });

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

  const handleDelete = () => {
    Alert.alert('Delete game', 'This will permanently remove the game.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMutation.mutate(),
      },
    ]);
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
              icon={<Ionicons name="create-outline" size={22} color={palette.text} />}
            />
            <IconAction
              accessibilityLabel="Delete game"
              onPress={handleDelete}
              icon={<Ionicons name="trash-outline" size={22} color={palette.text} />}
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
            {gameQuery.isPending ? (
              <View style={styles.loadingRow}>
                <BowlingBallSpinner size={20} />
                <Text style={styles.loadingText}>Loading scoreboard...</Text>
              </View>
            ) : gameQuery.error ? (
              <InfoBanner
                tone="error"
                text={
                  gameQuery.error instanceof Error ? gameQuery.error.message : 'Failed to load game.'
                }
              />
            ) : gameQuery.data?.game ? (
              <FrameGrid frames={buildFrameGrid(gameQuery.data.game)} />
            ) : null}

            {deleteError ? <InfoBanner tone="error" text={deleteError} /> : null}
          </View>
        ) : null}
      </View>

      <GameEditSheet visible={editOpen} gameId={game.id} onClose={() => setEditOpen(false)} />
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
    fontSize: 30,
    lineHeight: 30,
    fontWeight: '400',
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
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
