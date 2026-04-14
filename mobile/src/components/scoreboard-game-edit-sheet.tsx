import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import KeyboardAwareScrollView from '@/components/keyboard-aware-scroll-view';
import MultiPlayerFrameGrid from '@/components/multi-player-frame-grid';
import SurfaceCard from '@/components/surface-card';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import {
  computeTotalScore,
  normalizeLiveFrameShots,
  normalizeLivePlayers,
  normalizePlayerKey,
  type ResolvedLivePlayer,
} from '@/lib/live-session';
import type { LiveExtraction, LivePlayer } from '@/lib/types';

type EditableShot = {
  shotNumber: number;
  pinsText: string;
};

type EditableFrame = {
  frameNumber: number;
  shots: EditableShot[];
};

type EditablePlayer = {
  playerName: string;
  frames: EditableFrame[];
};

type ScoreboardGameEditSheetProps = {
  visible: boolean;
  extraction?: LiveExtraction | null;
  selectedPlayerKeys?: string[];
  saving?: boolean;
  errorText?: string;
  title: string;
  subtitle: string;
  saveLabel: string;
  savingLabel?: string;
  disabled?: boolean;
  onClose: () => void;
  onSave: (players: LivePlayer[]) => void;
};

function createEditablePlayers(extraction?: LiveExtraction | null) {
  return normalizeLivePlayers(extraction).map<EditablePlayer>((player) => ({
    playerName: player.playerName,
    frames: player.frames.map((frame) => ({
      frameNumber: frame.frame,
      shots: frame.shots.map((pins, index) => ({
        shotNumber: index + 1,
        pinsText: typeof pins === 'number' ? String(pins) : '',
      })),
    })),
  }));
}

function parsePinsInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildPlayersFromDraft(players: EditablePlayer[]): LivePlayer[] {
  return players.map((player) => {
    const frames = player.frames.map((frame) => ({
      frame: frame.frameNumber,
      shots: normalizeLiveFrameShots(
        frame.frameNumber,
        frame.shots.map((shot) => parsePinsInput(shot.pinsText)),
      ),
    }));

    return {
      playerName: player.playerName.trim() || 'Player',
      totalScore: computeTotalScore(frames),
      frames,
    };
  });
}

function buildPreviewPlayers(players: EditablePlayer[]): ResolvedLivePlayer[] {
  return normalizeLivePlayers({
    players: buildPlayersFromDraft(players),
  });
}

function syncPreviewSelectedPlayerKeys(
  previousPlayers: ResolvedLivePlayer[],
  nextPlayers: ResolvedLivePlayer[],
  currentSelectedKeys: string[],
) {
  const currentSelectedSet = new Set(
    currentSelectedKeys.map((entry) => normalizePlayerKey(entry)).filter(Boolean),
  );
  const previousPlayerKeySet = new Set(previousPlayers.map((player) => player.playerKey));
  const mappedKeys = new Set<string>();

  currentSelectedSet.forEach((selectedKey) => {
    if (!previousPlayerKeySet.has(selectedKey)) {
      mappedKeys.add(selectedKey);
      return;
    }

    const selectedIndex = previousPlayers.findIndex((player) => player.playerKey === selectedKey);
    const replacement =
      selectedIndex >= 0 ? nextPlayers[selectedIndex]?.playerKey ?? null : null;
    if (replacement) {
      mappedKeys.add(replacement);
    }
  });

  nextPlayers.forEach((player) => {
    if (currentSelectedSet.has(player.playerKey)) {
      mappedKeys.add(player.playerKey);
    }
  });

  return Array.from(mappedKeys);
}

export default function ScoreboardGameEditSheet({
  visible,
  extraction,
  selectedPlayerKeys = [],
  saving = false,
  errorText = '',
  title,
  subtitle,
  saveLabel,
  savingLabel = 'Saving...',
  disabled = false,
  onClose,
  onSave,
}: ScoreboardGameEditSheetProps) {
  const [players, setPlayers] = useState<EditablePlayer[]>([]);

  useEffect(() => {
    setPlayers(createEditablePlayers(extraction));
  }, [extraction]);

  const initialPlayers = useMemo(() => normalizeLivePlayers(extraction), [extraction]);
  const previewPlayers = useMemo(() => buildPreviewPlayers(players), [players]);
  const previewSelectedPlayerKeys = useMemo(
    () => syncPreviewSelectedPlayerKeys(initialPlayers, previewPlayers, selectedPlayerKeys),
    [initialPlayers, previewPlayers, selectedPlayerKeys],
  );

  if (!visible) {
    return null;
  }

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior="padding"
        enabled={Platform.OS === 'ios'}
        style={styles.backdrop}>
        <SurfaceCard style={styles.sheet} tone="raised">
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>

          <KeyboardAwareScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {previewPlayers.length > 0 ? (
              <View style={styles.previewWrap}>
                <MultiPlayerFrameGrid
                  players={previewPlayers}
                  selectedPlayerKeys={previewSelectedPlayerKeys}
                />
              </View>
            ) : null}

            <View style={styles.playerList}>
              {players.map((player, playerIndex) => (
                <SurfaceCard key={`player-${playerIndex}`} style={styles.playerCard}>
                  <Text style={styles.playerTitle}>Player {playerIndex + 1}</Text>
                  <TextInput
                    placeholder="Player name"
                    placeholderTextColor={palette.muted}
                    style={styles.nameInput}
                    value={player.playerName}
                    onChangeText={(value) => {
                      setPlayers((current) =>
                        current.map((entry, index) =>
                          index === playerIndex ? { ...entry, playerName: value } : entry,
                        ),
                      );
                    }}
                  />

                  <View style={styles.frameList}>
                    {player.frames.map((frame) => (
                      <View key={`${playerIndex}-${frame.frameNumber}`} style={styles.frameCard}>
                        <Text style={styles.frameTitle}>Frame {frame.frameNumber}</Text>
                        <View style={styles.shotRow}>
                          {frame.shots
                            .slice(0, frame.frameNumber === 10 ? 3 : 2)
                            .map((shot) => (
                              <View
                                key={`${playerIndex}-${frame.frameNumber}-${shot.shotNumber}`}
                                style={styles.shotField}>
                                <Text style={styles.shotLabel}>Shot {shot.shotNumber}</Text>
                                <TextInput
                                  keyboardType="number-pad"
                                  placeholder="-"
                                  placeholderTextColor={palette.muted}
                                  style={styles.shotInput}
                                  value={shot.pinsText}
                                  onChangeText={(value) => {
                                    setPlayers((current) =>
                                      current.map((entry, entryIndex) =>
                                        entryIndex === playerIndex
                                          ? {
                                              ...entry,
                                              frames: entry.frames.map((entryFrame) =>
                                                entryFrame.frameNumber === frame.frameNumber
                                                  ? {
                                                      ...entryFrame,
                                                      shots: entryFrame.shots.map((entryShot) =>
                                                        entryShot.shotNumber === shot.shotNumber
                                                          ? {
                                                              ...entryShot,
                                                              pinsText: value
                                                                .replace(/[^0-9]/g, '')
                                                                .slice(0, 2),
                                                            }
                                                          : entryShot,
                                                      ),
                                                    }
                                                  : entryFrame,
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
                </SurfaceCard>
              ))}
            </View>
          </KeyboardAwareScrollView>

          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              disabled={saving || disabled || players.length === 0}
              onPress={() => onSave(buildPlayersFromDraft(players))}
              style={({ pressed }) => [
                styles.primaryButton,
                (saving || disabled || players.length === 0) && styles.disabled,
                pressed && styles.pressed,
              ]}>
              {saving ? (
                <View style={styles.savingRow}>
                  <BowlingBallSpinner size={18} holeColor={palette.accent} />
                  <Text style={styles.primaryButtonText}>{savingLabel}</Text>
                </View>
              ) : (
                <Text style={styles.primaryButtonText}>{saveLabel}</Text>
              )}
            </Pressable>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </View>
        </SurfaceCard>
      </KeyboardAvoidingView>
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
    minHeight: '76%',
    maxHeight: '94%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
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
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  previewWrap: {
    gap: spacing.sm,
  },
  playerList: {
    gap: spacing.md,
  },
  playerCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  playerTitle: {
    color: palette.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  nameInput: {
    backgroundColor: palette.field,
    color: palette.text,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fontFamilySans,
  },
  frameList: {
    gap: spacing.sm,
  },
  frameCard: {
    backgroundColor: palette.field,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  frameTitle: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
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
  shotInput: {
    backgroundColor: palette.surfaceRaised,
    color: palette.text,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 20,
    textAlign: 'center',
    fontFamily: fontFamilySans,
  },
  errorText: {
    color: palette.error,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  actions: {
    gap: spacing.sm,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: radii.lg,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: radii.lg,
    backgroundColor: palette.field,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  disabled: {
    opacity: 0.55,
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.92,
  },
});
