import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import FrameGrid from '@/components/frame-grid';
import SurfaceCard from '@/components/surface-card';
import { fetchGameById, queryKeys, updateGame } from '@/lib/backend';
import { buildFrameGrid } from '@/lib/bowling';
import {
  combineLocalDateAndTime,
  toLocalDateInputValue,
  toLocalTimeInputValue,
} from '@/lib/date-time';
import { palette, radii, spacing } from '@/constants/palette';
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

type GameEditSheetProps = {
  visible: boolean;
  gameId: string;
  onClose: () => void;
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

export default function GameEditSheet({
  visible,
  gameId,
  onClose,
}: GameEditSheetProps) {
  const queryClient = useQueryClient();
  const [frames, setFrames] = useState<EditableFrame[]>([]);
  const [playedOnDate, setPlayedOnDate] = useState('');
  const [playedOnTime, setPlayedOnTime] = useState('');
  const [error, setError] = useState('');

  const gameQuery = useQuery({
    queryKey: queryKeys.game(gameId),
    queryFn: () => fetchGameById(gameId),
    enabled: visible,
  });

  useEffect(() => {
    if (gameQuery.data?.game) {
      setFrames(createEditableFrames(gameQuery.data.game));
      const dateSource = gameQuery.data.game.played_at || gameQuery.data.game.created_at;
      setPlayedOnDate(toLocalDateInputValue(dateSource));
      setPlayedOnTime(toLocalTimeInputValue(dateSource));
      setError('');
    }
  }, [gameQuery.data?.game]);

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
      onClose();
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save game.');
    },
  });

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SurfaceCard style={styles.sheet} tone="raised">
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Edit Game</Text>
            <Text style={styles.subtitle}>Review the scoreboard and update any frame marks.</Text>
          </View>

          {gameQuery.isPending ? (
            <View style={styles.loadingState}>
              <BowlingBallSpinner size={28} />
              <Text style={styles.loadingText}>Loading game...</Text>
            </View>
          ) : gameQuery.error ? (
            <Text style={styles.errorText}>
              {gameQuery.error instanceof Error ? gameQuery.error.message : 'Failed to load game.'}
            </Text>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}>
              <SurfaceCard style={styles.dateTimeCard}>
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
              </SurfaceCard>

              {previewGame ? (
                <View style={styles.gridWrap}>
                  <FrameGrid frames={buildFrameGrid(previewGame)} />
                </View>
              ) : null}

              <View style={styles.frameList}>
                {frames.map((frame) => (
                  <SurfaceCard key={frame.frameNumber} style={styles.frameCard}>
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
                                            ? {
                                                ...entryShot,
                                                pinsText: value.replace(/[^0-9]/g, '').slice(0, 2),
                                              }
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
                  </SurfaceCard>
                ))}
              </View>
            </ScrollView>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              onPress={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || gameQuery.isPending || !gameQuery.data?.game}
              style={({ pressed }) => [
                styles.primaryButton,
                (saveMutation.isPending || gameQuery.isPending || !gameQuery.data?.game) && styles.disabled,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.primaryButtonText}>
                {saveMutation.isPending ? 'Saving...' : 'Save game'}
              </Text>
            </Pressable>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </View>
        </SurfaceCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: palette.overlay,
  },
  sheet: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    minHeight: '70%',
    maxHeight: '92%',
    gap: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: palette.border,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  subtitle: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  loadingState: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  loadingText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  gridWrap: {
    gap: spacing.sm,
  },
  dateTimeCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dateTimeField: {
    flex: 1,
    gap: spacing.xs,
  },
  frameList: {
    gap: spacing.md,
  },
  frameCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  frameTitle: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  shotRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  shotField: {
    flex: 1,
    gap: spacing.xs,
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
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fontFamilySans,
    textAlign: 'center',
  },
  dateInput: {
    textAlign: 'left',
  },
  actions: {
    gap: spacing.sm,
  },
  primaryButton: {
    backgroundColor: palette.accent,
    borderRadius: radii.md,
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
  secondaryButton: {
    backgroundColor: palette.background,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  errorText: {
    color: palette.error,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.9,
  },
});
