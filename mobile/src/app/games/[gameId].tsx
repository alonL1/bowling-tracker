import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import CenteredState from '@/components/centered-state';
import DetailShell from '@/components/detail-shell';
import FrameGrid from '@/components/frame-grid';
import {
  deleteGame,
  fetchGameById,
  fetchGames,
  queryKeys,
  updateGame,
} from '@/lib/backend';
import { buildFrameGrid, buildSessionGroups } from '@/lib/bowling';
import { confirmAction } from '@/lib/confirm';
import {
  combineLocalDateAndTime,
  toLocalDateInputValue,
  toLocalTimeInputValue,
} from '@/lib/date-time';
import { navigateBackOrFallback } from '@/lib/navigation';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import type { FrameDetail, GameDetail } from '@/lib/types';

type EditableShot = {
  id?: string | null;
  shotNumber: number;
  pinsText: string;
};

type EditableFrame = {
  frameId?: string | null;
  frameNumber: number;
  shots: EditableShot[];
};

function createEditableFrames(game: GameDetail): EditableFrame[] {
  return Array.from({ length: 10 }, (_, index) => {
    const frameNumber = index + 1;
    const frame = (game.frames ?? []).find((entry) => entry.frame_number === frameNumber);
    return {
      frameId: frame?.id ?? null,
      frameNumber,
      shots: [1, 2, 3].map((shotNumber) => {
        const shot = frame?.shots?.find((entry) => entry.shot_number === shotNumber);
        return {
          id: shot?.id ?? null,
          shotNumber,
          pinsText: typeof shot?.pins === 'number' ? String(shot.pins) : '',
        };
      }),
    };
  });
}

function parsePinsInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPreviewGame(game: GameDetail, frames: EditableFrame[]): GameDetail {
  const previewFrames: FrameDetail[] = frames.map((frame) => {
    const shot1 = parsePinsInput(frame.shots[0]?.pinsText ?? '');
    const shot2 = parsePinsInput(frame.shots[1]?.pinsText ?? '');
    return {
      id: frame.frameId ?? null,
      frame_number: frame.frameNumber,
      is_strike: shot1 === 10,
      is_spare: shot1 !== null && shot2 !== null && shot1 !== 10 && shot1 + shot2 === 10,
      shots: frame.shots.map((shot) => ({
        id: shot.id ?? null,
        shot_number: shot.shotNumber,
        pins: parsePinsInput(shot.pinsText),
      })),
    };
  });

  return {
    ...game,
    frames: previewFrames,
  };
}

function formatGameMeta(game: GameDetail) {
  const dateSource = game.played_at || game.created_at;
  if (!dateSource) {
    return game.player_name;
  }
  const date = new Date(dateSource);
  if (Number.isNaN(date.getTime())) {
    return game.player_name;
  }
  return `${game.player_name} | ${date.toLocaleDateString('en-US')} ${date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

export default function GameDetailScreen() {
  const router = useRouter();
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const queryClient = useQueryClient();
  const [frames, setFrames] = useState<EditableFrame[]>([]);
  const [playedOnDate, setPlayedOnDate] = useState('');
  const [playedOnTime, setPlayedOnTime] = useState('');
  const [error, setError] = useState('');

  const gameQuery = useQuery({
    queryKey: queryKeys.game(gameId),
    queryFn: () => fetchGameById(gameId),
    enabled: Boolean(gameId),
  });
  const gamesQuery = useQuery({
    queryKey: queryKeys.games,
    queryFn: fetchGames,
  });

  useEffect(() => {
    if (gameQuery.data?.game) {
      setFrames(createEditableFrames(gameQuery.data.game));
      const dateSource = gameQuery.data.game.played_at || gameQuery.data.game.created_at;
      setPlayedOnDate(toLocalDateInputValue(dateSource));
      setPlayedOnTime(toLocalTimeInputValue(dateSource));
    }
  }, [gameQuery.data?.game]);

  const title = useMemo(() => {
    const feedGames = gamesQuery.data?.games ?? [];
    const grouping = buildSessionGroups(feedGames);
    return grouping.gameTitleMap.get(gameId) || gameQuery.data?.game.game_name?.trim() || 'Game';
  }, [gameId, gameQuery.data?.game.game_name, gamesQuery.data?.games]);

  const previewGame = useMemo(() => {
    if (!gameQuery.data?.game) {
      return null;
    }
    return buildPreviewGame(gameQuery.data.game, frames);
  }, [frames, gameQuery.data?.game]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!gameQuery.data?.game) {
        throw new Error('Game was not found.');
      }
      return updateGame({
        gameId: gameQuery.data.game.id,
        playedAt: combineLocalDateAndTime(playedOnDate, playedOnTime),
        frames: frames.map((frame) => ({
          frameId: frame.frameId ?? null,
          frameNumber: frame.frameNumber,
          shots: frame.shots.map((shot) => ({
            id: shot.id ?? null,
            shotNumber: shot.shotNumber,
            pins: parsePinsInput(shot.pinsText),
          })),
        })),
      });
    },
    onSuccess: async () => {
      setError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.game(gameId) }),
      ]);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save game.');
    },
  });

  if (gameQuery.isPending) {
    return <CenteredState title="Loading game..." loading />;
  }

  const game = gameQuery.data?.game;
  if (!game) {
    return (
      <DetailShell title="Game not found" subtitle="This game no longer exists.">
        <View style={styles.messageCard}>
          <Text style={styles.messageText}>Go back and refresh your sessions.</Text>
        </View>
      </DetailShell>
    );
  }

  const handleDelete = () => {
    confirmAction({
      title: 'Delete game',
      message: 'This will permanently remove the game.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteGame(game.id);
          await queryClient.invalidateQueries({ queryKey: queryKeys.games });
          navigateBackOrFallback(router, '/(tabs)/sessions');
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : 'Failed to delete game.');
        }
      },
    });
  };

  return (
    <DetailShell
      title={title}
      subtitle={`${typeof game.total_score === 'number' ? game.total_score : '—'} | ${formatGameMeta(game)}`}
      trailing={
        <Pressable onPress={handleDelete} style={({ pressed }) => [styles.inlineButton, pressed && styles.pressed]}>
          <Text style={styles.inlineButtonText}>Delete</Text>
        </Pressable>
      }>
      {error ? (
        <View style={styles.messageCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {previewGame ? (
        <View style={styles.gridWrap}>
          <FrameGrid frames={buildFrameGrid(previewGame)} />
        </View>
      ) : null}

      <View style={styles.frameCard}>
        <Text style={styles.frameTitle}>Date and Time</Text>
        <View style={styles.dateTimeRow}>
          <View style={styles.dateTimeField}>
            <Text style={styles.shotLabel}>Date</Text>
            <TextInput
              placeholder="YYYY-MM-DD"
              placeholderTextColor={palette.muted}
              style={[styles.input, styles.dateInput]}
              value={playedOnDate}
              onChangeText={(value) =>
                setPlayedOnDate(value.replace(/[^0-9-]/g, '').slice(0, 10))
              }
            />
          </View>
          <View style={styles.dateTimeField}>
            <Text style={styles.shotLabel}>Time</Text>
            <TextInput
              placeholder="HH:MM"
              placeholderTextColor={palette.muted}
              style={[styles.input, styles.dateInput]}
              value={playedOnTime}
              onChangeText={(value) =>
                setPlayedOnTime(value.replace(/[^0-9:]/g, '').slice(0, 5))
              }
            />
          </View>
        </View>
      </View>

      <View style={styles.formList}>
        {frames.map((frame) => (
          <View key={frame.frameNumber} style={styles.frameCard}>
            <Text style={styles.frameTitle}>Frame {frame.frameNumber}</Text>
            <View style={styles.shotRow}>
              {frame.shots.slice(0, frame.frameNumber === 10 ? 3 : 2).map((shot) => (
                <View key={shot.shotNumber} style={styles.shotField}>
                  <Text style={styles.shotLabel}>Shot {shot.shotNumber}</Text>
                  <TextInput
                    keyboardType="number-pad"
                    placeholder="-"
                    placeholderTextColor={palette.muted}
                    style={styles.input}
                    value={shot.pinsText}
                    onChangeText={(value) => {
                      setFrames((current) =>
                        current.map((entry) =>
                          entry.frameNumber === frame.frameNumber
                            ? {
                                ...entry,
                                shots: entry.shots.map((entryShot) =>
                                  entryShot.shotNumber === shot.shotNumber
                                    ? { ...entryShot, pinsText: value.replace(/[^0-9]/g, '').slice(0, 2) }
                                    : entryShot,
                                ),
                              }
                            : entry,
                        ),
                      );
                    }}
                  />
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      <Pressable
        onPress={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        style={({ pressed }) => [
          styles.primaryButton,
          saveMutation.isPending && styles.disabled,
          pressed && styles.pressed,
        ]}>
        <Text style={styles.primaryButtonText}>{saveMutation.isPending ? 'Saving...' : 'Save game'}</Text>
      </Pressable>
    </DetailShell>
  );
}

const styles = StyleSheet.create({
  inlineButton: {
    backgroundColor: palette.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inlineButtonText: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  messageCard: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  messageText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  errorText: {
    color: '#ff9ca7',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  gridWrap: {
    gap: spacing.sm,
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dateTimeField: {
    flex: 1,
    gap: 6,
  },
  formList: {
    gap: spacing.md,
  },
  frameCard: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  frameTitle: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  shotRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  shotField: {
    flex: 1,
    gap: 6,
  },
  shotLabel: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  input: {
    backgroundColor: palette.field,
    color: palette.text,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 20,
    fontFamily: fontFamilySans,
    textAlign: 'center',
  },
  dateInput: {
    textAlign: 'left',
  },
  primaryButton: {
    backgroundColor: palette.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.9,
  },
});
