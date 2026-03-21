import { File as ExpoFile } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import CenteredState from '@/components/centered-state';
import IconAction from '@/components/icon-action';
import InfoBanner from '@/components/info-banner';
import LiveGameEditSheet from '@/components/live-game-edit-sheet';
import LiveSessionGameCard from '@/components/live-session-game-card';
import StackBadge from '@/components/stack-badge';
import SurfaceCard from '@/components/surface-card';
import {
  deleteLiveSessionGame,
  discardLiveSession,
  endLiveSession,
  fetchLiveSession,
  queryKeys,
  queueLiveSessionCapture,
  updateLiveSession,
  updateLiveSessionGame,
} from '@/lib/backend';
import {
  buildLivePlayerComparisons,
  type LivePlayerComparisonMetric,
  type LivePlayerComparisonRow,
  buildLiveSessionStats,
  buildProjectedLoggedGameCount,
  canonicalizePlayerLabel,
  getFirstSelectionValidationError,
} from '@/lib/live-session';
import { formatTenths } from '@/lib/number-format';
import { confirmAction } from '@/lib/confirm';
import { deriveCapturedAtHint, sanitizeFilename } from '@/lib/upload';
import { supabase } from '@/lib/supabase';
import type { LiveSessionGame, LiveSessionResponse, LiveSessionStats } from '@/lib/types';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { useAuth } from '@/providers/auth-provider';

const DEFAULT_BUCKET = 'scoreboards-temp';
const BASE_CONTENT_BOTTOM_PADDING = 132;

async function getUploadBody(asset: ImagePicker.ImagePickerAsset) {
  if (asset.file) {
    return asset.file;
  }

  const file = new ExpoFile(asset.uri);
  return file.arrayBuffer();
}

function updateLiveSessionCache(
  current: LiveSessionResponse | undefined,
  updater: (payload: NonNullable<LiveSessionResponse['liveSession']>) => NonNullable<LiveSessionResponse['liveSession']>,
) {
  if (!current?.liveSession) {
    return current;
  }

  return {
    ...current,
    liveSession: updater(current.liveSession),
  };
}

type StatsTileProps = {
  label: string;
  value: string;
  onPress?: () => void;
};

type LiveTabKey = 'games' | 'stats';

const comparisonCategories: Array<{ key: LivePlayerComparisonMetric; label: string }> = [
  { key: 'average', label: 'Average' },
  { key: 'bestScore', label: 'Best Score' },
  { key: 'bestSeries', label: 'Best Series' },
  { key: 'games', label: '# of Games' },
  { key: 'strikeRate', label: 'Strike Rate' },
  { key: 'strikes', label: '# of Strikes' },
  { key: 'spareConversionRate', label: 'Spare Conversion' },
  { key: 'nines', label: '# of 9s' },
  { key: 'bestFrame', label: 'Best Frame' },
  { key: 'worstFrame', label: 'Worst Frame' },
];

function getComparisonMetricValue(
  row: LivePlayerComparisonRow,
  metric: LivePlayerComparisonMetric,
) {
  switch (metric) {
    case 'average':
      return row.average;
    case 'bestScore':
      return row.bestScore;
    case 'bestSeries':
      return row.bestSeries;
    case 'games':
      return row.games;
    case 'strikeRate':
      return row.strikeRate;
    case 'strikes':
      return row.strikes;
    case 'spareConversionRate':
      return row.spareConversionRate;
    case 'nines':
      return row.nines;
    case 'bestFrame':
      return row.bestFrame;
    case 'worstFrame':
      return row.worstFrame;
  }
}

function getStatsTileValue(stats: LiveSessionStats, metric: LivePlayerComparisonMetric) {
  switch (metric) {
    case 'average':
      return stats.averageLabel;
    case 'bestScore':
      return stats.bestScoreLabel;
    case 'bestSeries':
      return stats.bestSeriesLabel;
    case 'games':
      return stats.gameCountLabel;
    case 'strikeRate':
      return stats.strikeRateLabel;
    case 'strikes':
      return stats.strikesLabel;
    case 'spareConversionRate':
      return stats.spareConversionRateLabel;
    case 'nines':
      return stats.ninesLabel;
    case 'bestFrame':
      return stats.bestFrameLabel;
    case 'worstFrame':
      return stats.worstFrameLabel;
  }
}

function formatComparisonMetricValue(
  metric: LivePlayerComparisonMetric,
  value: number | null,
) {
  if (value === null || Number.isNaN(value)) {
    return '—';
  }

  if (
    metric === 'average' ||
    metric === 'bestFrame' ||
    metric === 'worstFrame' ||
    metric === 'strikeRate' ||
    metric === 'spareConversionRate'
  ) {
    const formatted = formatTenths(value);
    return metric === 'strikeRate' || metric === 'spareConversionRate'
      ? `${formatted}%`
      : formatted;
  }

  return String(Math.round(value));
}

function getComparisonMetricDisplayLabel(
  row: LivePlayerComparisonRow,
  metric: LivePlayerComparisonMetric,
) {
  if (metric === 'bestFrame') {
    return row.bestFrameLabel;
  }
  if (metric === 'worstFrame') {
    return row.worstFrameLabel;
  }

  return formatComparisonMetricValue(metric, getComparisonMetricValue(row, metric));
}

function StatsTile({ label, value, onPress }: StatsTileProps) {
  const content = (
    <>
      <Text style={styles.statsLabel}>{label}</Text>
      <Text style={styles.statsValue}>{value}</Text>
    </>
  );

  if (!onPress) {
    return <View style={styles.statsTile}>{content}</View>;
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.statsTile, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

export default function LiveSessionScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const scrollRef = useRef<ScrollView | null>(null);
  const pagerRef = useRef<ScrollView | null>(null);
  const comparisonCategoryScrollRef = useRef<ScrollView | null>(null);

  const [sourceOpen, setSourceOpen] = useState(false);
  const [endSessionOpen, setEndSessionOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [error, setError] = useState('');
  const [editingGame, setEditingGame] = useState<LiveSessionGame | null>(null);
  const [deletingGameIds, setDeletingGameIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<LiveTabKey>('games');
  const [selectedComparisonMetric, setSelectedComparisonMetric] =
    useState<LivePlayerComparisonMetric>('average');
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [pagerWidth, setPagerWidth] = useState(0);
  const [pagerScrollEnabled, setPagerScrollEnabled] = useState(true);
  const [endDockHeight, setEndDockHeight] = useState(0);
  const selectionRevisionRef = useRef(0);
  const pendingScrollGameIdRef = useRef<string | null>(null);
  const gameLayoutYRef = useRef<Record<string, number>>({});
  const comparisonLoadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comparisonRenderFrameRef = useRef<number | null>(null);
  const pagerViewportYRef = useRef(0);
  const compareSectionYRef = useRef(0);
  const comparisonCategoryLayoutsRef = useRef<
    Partial<Record<LivePlayerComparisonMetric, { x: number; width: number }>>
  >({});
  const comparisonCategoryViewportWidthRef = useRef(0);

  const liveSessionQuery = useQuery({
    queryKey: queryKeys.liveSession,
    queryFn: fetchLiveSession,
    refetchInterval: (query) => {
      const data = query.state.data as LiveSessionResponse | undefined;
      const hasActiveProcessing = data?.liveSession?.games?.some(
        (game) => game.status === 'queued' || game.status === 'processing',
      );
      return hasActiveProcessing ? 2500 : false;
    },
  });

  const liveSession = liveSessionQuery.data?.liveSession ?? null;

  useEffect(() => {
    if (!liveSession) {
      return;
    }
    setDraftName(liveSession.name?.trim() || '');
    setDraftDescription(liveSession.description?.trim() || '');
  }, [liveSession?.id, liveSession?.name, liveSession?.description]);

  useEffect(() => {
    return () => {
      if (comparisonLoadTimeoutRef.current) {
        clearTimeout(comparisonLoadTimeoutRef.current);
      }
      if (comparisonRenderFrameRef.current !== null) {
        cancelAnimationFrame(comparisonRenderFrameRef.current);
      }
    };
  }, []);

  const scrollToGame = (gameId: string) => {
    const y = gameLayoutYRef.current[gameId];
    if (typeof y !== 'number') {
      return false;
    }

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, pagerViewportYRef.current + y - spacing.sm),
        animated: true,
      });
    });
    return true;
  };

  const isDeletingGame = (gameId: string) => deletingGameIds.includes(gameId);

  const handleGameLayout = (
    gameId: string,
    y: number,
    status: LiveSessionGame['status'],
  ) => {
    gameLayoutYRef.current[gameId] = y;
    if (
      status !== 'ready' &&
      pendingScrollGameIdRef.current === gameId &&
      scrollToGame(gameId)
    ) {
      pendingScrollGameIdRef.current = null;
    }
  };

  useEffect(() => {
    const pendingScrollGameId = pendingScrollGameIdRef.current;
    const targetGame = liveSession?.games?.find((game) => game.id === pendingScrollGameId);
    if (!pendingScrollGameId || !targetGame || targetGame.status === 'ready') {
      return;
    }

    if (scrollToGame(pendingScrollGameId)) {
      pendingScrollGameIdRef.current = null;
    }
  }, [liveSession?.games]);

  const readyGames = useMemo(
    () => (liveSession?.games ?? []).filter((game) => game.status === 'ready'),
    [liveSession?.games],
  );
  const nonReadyGames = useMemo(
    () => (liveSession?.games ?? []).filter((game) => game.status !== 'ready'),
    [liveSession?.games],
  );

  const selectedPlayerKeys = liveSession?.selectedPlayerKeys ?? [];
  const playerOptions = liveSession?.playerOptions ?? [];
  const stats = useMemo(
    () => buildLiveSessionStats(readyGames, selectedPlayerKeys),
    [readyGames, selectedPlayerKeys],
  );
  const playerComparisons = useMemo(() => buildLivePlayerComparisons(readyGames), [readyGames]);
  const projectedLoggedGameCount = useMemo(
    () => buildProjectedLoggedGameCount(readyGames, selectedPlayerKeys),
    [readyGames, selectedPlayerKeys],
  );
  const selectionError = useMemo(
    () => getFirstSelectionValidationError(readyGames, selectedPlayerKeys),
    [readyGames, selectedPlayerKeys],
  );
  const comparisonRows = useMemo(() => {
    return [...playerComparisons].sort((left, right) => {
      const leftValue = getComparisonMetricValue(left, selectedComparisonMetric);
      const rightValue = getComparisonMetricValue(right, selectedComparisonMetric);
      const normalizedLeft = leftValue ?? -1;
      const normalizedRight = rightValue ?? -1;
      if (normalizedRight !== normalizedLeft) {
        return normalizedRight - normalizedLeft;
      }
      return left.label.localeCompare(right.label);
    });
  }, [playerComparisons, selectedComparisonMetric]);
  const comparisonMaxValue = useMemo(() => {
    return comparisonRows.reduce((max, row) => {
      const value = getComparisonMetricValue(row, selectedComparisonMetric);
      return value !== null && value > max ? value : max;
    }, 0);
  }, [comparisonRows, selectedComparisonMetric]);
  const contentContainerStyle = useMemo(
    () => [
      styles.content,
      {
        paddingBottom: Math.max(BASE_CONTENT_BOTTOM_PADDING, endDockHeight + spacing.xl),
      },
    ],
    [endDockHeight],
  );

  const hasSelectedPlayers = selectedPlayerKeys.length > 0;
  const hasUnfinishedGames = nonReadyGames.some(
    (game) => game.status === 'queued' || game.status === 'processing',
  );
  const hasFailedGames = nonReadyGames.some((game) => game.status === 'error');

  const selectionMutation = useMutation({
    mutationFn: async ({
      nextSelectedPlayerKeys,
    }: {
      nextSelectedPlayerKeys: string[];
      revision: number;
    }) =>
      updateLiveSession({ selectedPlayerKeys: nextSelectedPlayerKeys }),
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to update selected players.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveSession });
    },
    onSuccess: (data, variables) => {
      if (variables.revision !== selectionRevisionRef.current) {
        return;
      }
      queryClient.setQueryData(queryKeys.liveSession, data);
    },
  });

  const captureMutation = useMutation({
    mutationFn: async (source: 'camera' | 'library') => {
      if (!user) {
        throw new Error('You must be signed in before starting a live session.');
      }

      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error(
          source === 'camera'
            ? 'Camera permission is required to capture a scoreboard.'
            : 'Photo library permission is required to pick a scoreboard.',
        );
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: 'images',
              exif: true,
              quality: 1,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: 'images',
              allowsMultipleSelection: false,
              exif: true,
              quality: 1,
            });

      if (result.canceled || result.assets.length === 0) {
        return null;
      }

      const asset = result.assets[0];
      setSourceOpen(false);
      setActiveTab('games');
      scrollToTab('games', true);
      const filename = sanitizeFilename(asset.fileName ?? undefined, 0);
      const storageKey = `${user.id}/${Date.now()}-${filename}`;
      const uploadBody = await getUploadBody(asset);

      const upload = await supabase.storage.from(DEFAULT_BUCKET).upload(storageKey, uploadBody, {
        contentType: asset.mimeType ?? 'image/jpeg',
        upsert: false,
      });

      if (upload.error) {
        throw new Error(upload.error.message || 'Failed to upload scoreboard image.');
      }

      try {
        return queueLiveSessionCapture({
          storageKey,
          capturedAtHint: deriveCapturedAtHint(asset),
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
          name: liveSession ? undefined : draftName,
          description: liveSession ? undefined : draftDescription,
        });
      } catch (nextError) {
        await supabase.storage.from(DEFAULT_BUCKET).remove([storageKey]);
        throw nextError;
      }
    },
    onSuccess: async (payload) => {
      if (!payload) {
        return;
      }

      setSourceOpen(false);
      setError('');
      pendingScrollGameIdRef.current = payload.liveGameId;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.liveSession }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus }),
      ]);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to add scoreboard.');
    },
  });

  const editGameMutation = useMutation({
    mutationFn: updateLiveSessionGame,
    onSuccess: async () => {
      setEditingGame(null);
      setError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.liveSession }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus }),
      ]);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save live game.');
    },
  });

  const deleteGameMutation = useMutation({
    mutationFn: (liveGameId: string) => deleteLiveSessionGame(liveGameId),
    onMutate: (liveGameId) => {
      setDeletingGameIds((current) =>
        current.includes(liveGameId) ? current : [...current, liveGameId],
      );
    },
    onSuccess: async (payload) => {
      if (payload.deletedSession) {
        setDraftName('');
        setDraftDescription('');
      }
      setError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.liveSession }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus }),
      ]);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to delete live game.');
    },
    onSettled: (_data, _error, liveGameId) => {
      setDeletingGameIds((current) => current.filter((entry) => entry !== liveGameId));
    },
  });

  const discardLiveSessionMutation = useMutation({
    mutationFn: discardLiveSession,
    onSuccess: async () => {
      setError('');
      setDraftName('');
      setDraftDescription('');
      setEditingGame(null);
      setEndSessionOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.liveSession }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus }),
      ]);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to discard live session.');
    },
  });

  const endSessionMutation = useMutation({
    mutationFn: async () => {
      if (!liveSession) {
        throw new Error('No active live session was found.');
      }

      const trimmedName = draftName.trim();
      const trimmedDescription = draftDescription.trim();
      const currentName = liveSession.name?.trim() || '';
      const currentDescription = liveSession.description?.trim() || '';

      if (trimmedName !== currentName || trimmedDescription !== currentDescription) {
        await updateLiveSession({
          name: trimmedName,
          description: trimmedDescription,
        });
      }

      return endLiveSession();
    },
    onSuccess: async (payload) => {
      setError('');
      setEndSessionOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.liveSession }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus }),
      ]);
      router.replace(`/sessions/${payload.sessionId}` as never);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to end live session.');
    },
  });

  const handleTogglePlayer = (playerKey: string) => {
    if (!liveSession) {
      return;
    }

    const nextSelectedPlayerKeys = selectedPlayerKeys.includes(playerKey)
      ? selectedPlayerKeys.filter((entry) => entry !== playerKey)
      : [...selectedPlayerKeys, playerKey];

    queryClient.setQueryData<LiveSessionResponse | undefined>(queryKeys.liveSession, (current) =>
      updateLiveSessionCache(current, (session) => ({
        ...session,
        selectedPlayerKeys: nextSelectedPlayerKeys,
      })),
    );

    selectionRevisionRef.current += 1;
    selectionMutation.mutate({
      nextSelectedPlayerKeys,
      revision: selectionRevisionRef.current,
    });
  };

  const handleEndSession = () => {
    if (!liveSession) {
      return;
    }
    setEndSessionOpen(true);
  };

  const handleDiscardLiveSession = () => {
    confirmAction({
      title: 'Discard live session',
      message: 'This removes the current live session and all of its uploaded scoreboards.',
      confirmLabel: 'Discard',
      destructive: true,
      onConfirm: () => discardLiveSessionMutation.mutate(),
    });
  };

  const handleSelectComparisonMetric = (metric: LivePlayerComparisonMetric) => {
    scrollComparisonCategoryIntoView(metric);

    if (metric === selectedComparisonMetric) {
      return;
    }

    if (comparisonLoadTimeoutRef.current) {
      clearTimeout(comparisonLoadTimeoutRef.current);
    }
    if (comparisonRenderFrameRef.current !== null) {
      cancelAnimationFrame(comparisonRenderFrameRef.current);
    }

    setSelectedComparisonMetric(metric);
    setComparisonLoading(false);
    comparisonLoadTimeoutRef.current = setTimeout(() => {
      setComparisonLoading(true);
      comparisonLoadTimeoutRef.current = null;
    }, 180);
    comparisonRenderFrameRef.current = requestAnimationFrame(() => {
      comparisonRenderFrameRef.current = requestAnimationFrame(() => {
        if (comparisonLoadTimeoutRef.current) {
          clearTimeout(comparisonLoadTimeoutRef.current);
          comparisonLoadTimeoutRef.current = null;
        }
        setComparisonLoading(false);
        comparisonRenderFrameRef.current = null;
      });
    });
  };

  const scrollToTab = (tab: LiveTabKey, animated: boolean) => {
    if (!pagerWidth) {
      return;
    }

    pagerRef.current?.scrollTo({
      x: tab === 'stats' ? pagerWidth : 0,
      y: 0,
      animated,
    });
  };

  const scrollToCompareSection = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, pagerViewportYRef.current + compareSectionYRef.current - spacing.md),
        animated: true,
      });
    });
  };

  const scrollComparisonCategoryIntoView = (metric: LivePlayerComparisonMetric) => {
    const layout = comparisonCategoryLayoutsRef.current[metric];
    if (!layout || !comparisonCategoryViewportWidthRef.current) {
      return;
    }

    const targetX = Math.max(
      0,
      layout.x - (comparisonCategoryViewportWidthRef.current - layout.width) / 2,
    );
    comparisonCategoryScrollRef.current?.scrollTo({ x: targetX, y: 0, animated: true });
  };

  const handlePressStatsTile = (metric: LivePlayerComparisonMetric) => {
    handleSelectComparisonMetric(metric);
    requestAnimationFrame(() => {
      scrollComparisonCategoryIntoView(metric);
      scrollToCompareSection();
    });
  };

  if (authLoading || (liveSessionQuery.isPending && !liveSessionQuery.data)) {
    return <CenteredState title="Loading live session..." loading />;
  }

  if (liveSessionQuery.error && !liveSessionQuery.data) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.centeredWrap}>
          <InfoBanner
            tone="error"
            text={
              liveSessionQuery.error instanceof Error
                ? liveSessionQuery.error.message
                : 'Failed to load live session.'
            }
          />
        </View>
      </SafeAreaView>
    );
  }

  const selectedLabels = playerOptions
    .filter((option) => selectedPlayerKeys.includes(option.key))
    .map((option) => canonicalizePlayerLabel(option.label));

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.page}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <Ionicons name="chevron-back" size={16} color={palette.muted} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>

            {liveSession ? (
              <Pressable
                onPress={handleDiscardLiveSession}
                disabled={discardLiveSessionMutation.isPending}
                style={({ pressed }) => [styles.discardButton, pressed && styles.pressed]}>
                {discardLiveSessionMutation.isPending ? (
                  <BowlingBallSpinner size={16} color={palette.text} holeColor={palette.field} />
                ) : (
                  <MaterialIcons name="delete-outline" size={18} color={palette.text} />
                )}
                <Text style={styles.discardText}>
                  {discardLiveSessionMutation.isPending
                    ? 'Discarding live session...'
                    : 'Discard Live Session'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.header}>
            <Text style={styles.pageTitle}>Live Session</Text>
          </View>

          {error ? <InfoBanner tone="error" text={error} /> : null}
          {liveSessionQuery.error ? (
            <InfoBanner
              tone="error"
              text={
                liveSessionQuery.error instanceof Error
                  ? liveSessionQuery.error.message
                  : 'Failed to refresh live session.'
              }
            />
          ) : null}

          <SurfaceCard style={styles.sectionCard}>
            <Text style={styles.sectionBody}>
              Capture one scoreboard after each game. The scoreboard stays as a draft until you end the session.
            </Text>
            <ActionButton
              label={captureMutation.isPending ? 'Adding game...' : 'Add Game'}
              leftIcon={
                captureMutation.isPending ? (
                  <BowlingBallSpinner size={18} color={palette.text} holeColor={palette.accent} />
                ) : (
                  <Ionicons name="add" size={18} color={palette.text} />
                )
              }
              onPress={() => setSourceOpen(true)}
              disabled={captureMutation.isPending}
            />
          </SurfaceCard>

          <SurfaceCard style={styles.sectionCard}>
            <Text style={styles.sectionBody}>
              {'Who are you?\n(may select multiple)'}
            </Text>
            {playerOptions.length === 0 ? (
              <Text style={styles.sectionBody}>
                Add a scoreboard to start extracting player names.
              </Text>
            ) : (
              <View style={styles.checkboxList}>
                {playerOptions.map((option) => {
                  const checked = selectedPlayerKeys.includes(option.key);
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => handleTogglePlayer(option.key)}
                      hitSlop={8}
                      style={({ pressed }) => [styles.checkboxRow, pressed && styles.pressed]}>
                      <MaterialIcons
                        name={checked ? 'check-box' : 'check-box-outline-blank'}
                        size={22}
                        color={checked ? palette.accent : palette.muted}
                      />
                      <Text style={styles.checkboxLabel}>{canonicalizePlayerLabel(option.label)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </SurfaceCard>

          <View style={styles.tabRow}>
            <Pressable
              onPress={() => {
                setActiveTab('games');
                scrollToTab('games', true);
              }}
              style={({ pressed }) => [
                styles.tabButton,
                activeTab === 'games' && styles.tabButtonActive,
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.tabLabel, activeTab === 'games' && styles.tabLabelActive]}>Games</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setActiveTab('stats');
                scrollToTab('stats', true);
              }}
              style={({ pressed }) => [
                styles.tabButton,
                activeTab === 'stats' && styles.tabButtonActive,
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.tabLabel, activeTab === 'stats' && styles.tabLabelActive]}>Stats</Text>
            </Pressable>
          </View>
          <View style={styles.tabDots}>
            <View style={[styles.tabDot, activeTab === 'games' && styles.tabDotActive]} />
            <View style={[styles.tabDot, activeTab === 'stats' && styles.tabDotActive]} />
          </View>

          <View
            style={styles.pagerViewport}
            onLayout={(event) => {
              const nextLayout = event.nativeEvent.layout;
              pagerViewportYRef.current = nextLayout.y;
              const nextWidth = Math.round(nextLayout.width);
              if (!nextWidth || nextWidth === pagerWidth) {
                return;
              }

              setPagerWidth(nextWidth);
              requestAnimationFrame(() => {
                scrollToTab(activeTab, false);
              });
            }}>
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              scrollEnabled={pagerScrollEnabled}
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) => {
                if (!pagerWidth) {
                  return;
                }
                const nextTab =
                  Math.round(event.nativeEvent.contentOffset.x / pagerWidth) === 1 ? 'stats' : 'games';
                setActiveTab(nextTab);
              }}>
              <View style={[styles.pagerPage, pagerWidth ? { width: pagerWidth } : null]}>
                {liveSession?.games?.length ? (
                  <View style={styles.gameList}>
                    {liveSession.games.map((game, index) =>
                      game.status === 'ready' ? (
                        <View
                          key={game.id}
                          onLayout={(event) => {
                            handleGameLayout(game.id, event.nativeEvent.layout.y, game.status);
                          }}>
                          <LiveSessionGameCard
                            game={game}
                            gameNumber={index + 1}
                            selectedPlayerKeys={selectedPlayerKeys}
                            deleting={isDeletingGame(game.id)}
                            onEdit={setEditingGame}
                            onDelete={(liveGameId) => deleteGameMutation.mutate(liveGameId)}
                            onScoreboardGestureStart={() => setPagerScrollEnabled(false)}
                            onScoreboardGestureEnd={() => setPagerScrollEnabled(true)}
                          />
                        </View>
                      ) : (
                        <View
                          key={game.id}
                          style={styles.pendingCard}
                          onLayout={(event) => {
                            handleGameLayout(game.id, event.nativeEvent.layout.y, game.status);
                          }}>
                          <View style={styles.pendingCardRow}>
                            <View style={styles.pendingSummary}>
                              <StackBadge lines={['Game', String(index + 1)]} />
                              <View style={styles.pendingTextBlock}>
                                <Text style={styles.pendingTitle}>
                                  {game.status === 'error' ? 'Scoreboard needs attention' : 'Processing scoreboard'}
                                </Text>
                                {game.last_error ? (
                                  <Text style={styles.pendingError}>{game.last_error}</Text>
                                ) : null}
                              </View>
                            </View>
                            <View style={styles.pendingActions}>
                              {(game.status === 'queued' || game.status === 'processing') &&
                              !isDeletingGame(game.id) ? (
                                <BowlingBallSpinner size={22} holeColor={palette.field} />
                              ) : null}
                              {isDeletingGame(game.id) ? (
                                <BowlingBallSpinner size={22} holeColor={palette.field} />
                              ) : (
                                <IconAction
                                  accessibilityLabel="Delete pending live game"
                                  onPress={() =>
                                    confirmAction({
                                      title: 'Delete game',
                                      message: 'Remove this scoreboard from the live session?',
                                      confirmLabel: 'Delete',
                                      destructive: true,
                                      onConfirm: () => deleteGameMutation.mutate(game.id),
                                    })
                                  }
                                  icon={<MaterialIcons name="delete" size={22} color={palette.text} />}
                                />
                              )}
                            </View>
                          </View>
                        </View>
                      ),
                    )}
                  </View>
                ) : (
                  <SurfaceCard style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No live games yet</Text>
                    <Text style={styles.emptyBody}>
                      After you finish a game, add a scoreboard photo here. Once it is processed, the draft game card will appear below.
                    </Text>
                  </SurfaceCard>
                )}
              </View>

              <View style={[styles.pagerPage, pagerWidth ? { width: pagerWidth } : null]}>
              <View style={styles.statsSection}>
                <View style={styles.statsGrid}>
                  {comparisonCategories.map((category) => (
                    <StatsTile
                      key={category.key}
                      label={category.label}
                      value={getStatsTileValue(stats, category.key)}
                      onPress={() => handlePressStatsTile(category.key)}
                    />
                  ))}
                </View>
                </View>

                <View
                  onLayout={(event) => {
                    compareSectionYRef.current = event.nativeEvent.layout.y;
                  }}>
                  <SurfaceCard style={styles.sectionCard}>
                    <Text style={styles.sectionBody}>Select category to compare players.</Text>
                    <ScrollView
                      ref={comparisonCategoryScrollRef}
                      horizontal
                      nestedScrollEnabled
                      showsHorizontalScrollIndicator={false}
                      onLayout={(event) => {
                        comparisonCategoryViewportWidthRef.current = event.nativeEvent.layout.width;
                      }}
                      onTouchStart={() => setPagerScrollEnabled(false)}
                      onTouchEnd={() => setPagerScrollEnabled(true)}
                      onTouchCancel={() => setPagerScrollEnabled(true)}
                      onScrollBeginDrag={() => setPagerScrollEnabled(false)}
                      onScrollEndDrag={() => setPagerScrollEnabled(true)}
                      onMomentumScrollEnd={() => setPagerScrollEnabled(true)}
                      contentContainerStyle={styles.comparisonCategoryRow}>
                      {comparisonCategories.map((category) => (
                        <Pressable
                          key={category.key}
                          onPress={() => handleSelectComparisonMetric(category.key)}
                          onLayout={(event) => {
                            comparisonCategoryLayoutsRef.current[category.key] = {
                              x: event.nativeEvent.layout.x,
                              width: event.nativeEvent.layout.width,
                            };
                          }}
                          style={({ pressed }) => [
                            styles.comparisonCategoryChip,
                            selectedComparisonMetric === category.key && styles.comparisonCategoryChipActive,
                            pressed && styles.pressed,
                          ]}>
                          <Text
                            style={[
                              styles.comparisonCategoryLabel,
                              selectedComparisonMetric === category.key && styles.comparisonCategoryLabelActive,
                            ]}>
                            {category.label}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>

                    <View style={styles.comparisonList}>
                      {comparisonRows.map((row) => {
                        const value = getComparisonMetricValue(row, selectedComparisonMetric);
                        const fillPercent =
                          value !== null && comparisonMaxValue > 0
                            ? Math.max(8, (value / comparisonMaxValue) * 100)
                            : 0;

                        return (
                          <View key={row.playerKey} style={styles.comparisonRow}>
                            <View style={styles.comparisonHeader}>
                              <Text style={styles.comparisonPlayerLabel}>{row.label}</Text>
                              <Text style={styles.comparisonValueLabel}>
                                {getComparisonMetricDisplayLabel(row, selectedComparisonMetric)}
                              </Text>
                            </View>
                            <View style={styles.comparisonBarTrack}>
                              <View
                                style={[
                                  styles.comparisonBarFill,
                                  { width: fillPercent > 0 ? `${fillPercent}%` : '0%' },
                                ]}
                              />
                            </View>
                          </View>
                        );
                      })}
                    </View>
                    {comparisonLoading ? (
                      <View style={styles.comparisonLoading}>
                        <BowlingBallSpinner size={28} holeColor={palette.surface} />
                      </View>
                    ) : null}
                  </SurfaceCard>
                </View>
              </View>
            </ScrollView>
          </View>
        </ScrollView>

        <View
          style={styles.endDock}
          onLayout={(event) => {
            const nextHeight = Math.ceil(event.nativeEvent.layout.height) + spacing.md;
            setEndDockHeight((current) => (current === nextHeight ? current : nextHeight));
          }}>
          {!hasSelectedPlayers ? (
            <Text style={styles.dockNote}>Choose at least one player before ending the session.</Text>
          ) : selectionError ? (
            <Text style={styles.dockNote}>{selectionError}</Text>
          ) : hasUnfinishedGames ? (
            <Text style={styles.dockNote}>Wait for all scoreboards to finish processing.</Text>
          ) : hasFailedGames ? (
            <Text style={styles.dockNote}>Remove or fix failed scoreboards before ending the session.</Text>
          ) : projectedLoggedGameCount > 0 ? (
            <Text style={styles.dockNote}>
              Ending this session will log {projectedLoggedGameCount} games from {readyGames.length} scoreboards.
            </Text>
          ) : null}
          <ActionButton
            label={endSessionMutation.isPending ? 'Ending session...' : 'End Session'}
            onPress={handleEndSession}
            disabled={
              endSessionMutation.isPending ||
              !liveSession ||
              !hasSelectedPlayers ||
              readyGames.length === 0 ||
              hasUnfinishedGames ||
              hasFailedGames ||
              Boolean(selectionError) ||
              projectedLoggedGameCount === 0
            }
          />
        </View>
      </View>

      <Modal transparent animationType="fade" visible={sourceOpen} onRequestClose={() => setSourceOpen(false)}>
        <View style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>Choose Source</Text>
            <ActionButton
              label="Camera"
              onPress={() => captureMutation.mutate('camera')}
              textStyle={styles.cameraButtonText}
              disabled={captureMutation.isPending}
            />
            <ActionButton
              label="Photo Library"
              onPress={() => captureMutation.mutate('library')}
              variant="secondary"
              style={styles.photoLibraryButton}
              disabled={captureMutation.isPending}
            />
            <ActionButton label="Cancel" onPress={() => setSourceOpen(false)} variant="secondary" />
          </SurfaceCard>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={endSessionOpen}
        onRequestClose={() => setEndSessionOpen(false)}>
        <KeyboardAvoidingView
          behavior="padding"
          enabled={Platform.OS === 'ios'}
          style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>End Session</Text>
            <Text style={styles.modalBody}>Ending this session is final.</Text>
            <View style={styles.summaryList}>
              <Text style={styles.summaryLine}>
                Selected names: {selectedLabels.join(', ') || 'None'}
              </Text>
              <Text style={styles.summaryLine}>Visible scoreboards: {readyGames.length}</Text>
              <Text style={styles.summaryLine}>
                Logged games that will be created: {projectedLoggedGameCount}
              </Text>
            </View>
            <Text style={styles.modalHint}>
              Optionally rename the session or add a description before ending it.
            </Text>
            <TextInput
              placeholder="Session name (optional)"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={draftName}
              onChangeText={setDraftName}
            />
            <TextInput
              placeholder="Description (optional)"
              placeholderTextColor={palette.muted}
              style={[styles.input, styles.descriptionInput]}
              multiline
              value={draftDescription}
              onChangeText={setDraftDescription}
            />
            <ActionButton
              label={endSessionMutation.isPending ? 'Ending session...' : 'End Session'}
              onPress={() => endSessionMutation.mutate()}
              disabled={endSessionMutation.isPending}
            />
            <ActionButton label="Cancel" onPress={() => setEndSessionOpen(false)} variant="secondary" />
          </SurfaceCard>
        </KeyboardAvoidingView>
      </Modal>

      <LiveGameEditSheet
        visible={Boolean(editingGame)}
        game={editingGame}
        selectedPlayerKeys={selectedPlayerKeys}
        saving={editGameMutation.isPending}
        errorText={editGameMutation.isError ? error : ''}
        onClose={() => setEditingGame(null)}
        onSave={(payload) => editGameMutation.mutate(payload)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  page: {
    flex: 1,
    backgroundColor: palette.background,
    position: 'relative',
  },
  scroll: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 18,
    paddingBottom: BASE_CONTENT_BOTTOM_PADDING,
    gap: spacing.md,
  },
  centeredWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  discardButton: {
    minHeight: 40,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  discardText: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  header: {
    gap: spacing.xs,
  },
  pageTitle: {
    color: palette.text,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  sectionCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  sectionBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  checkboxList: {
    gap: spacing.sm,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 46,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: palette.field,
  },
  checkboxLabel: {
    flex: 1,
    color: palette.text,
    fontSize: 16,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tabDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: -4,
  },
  tabDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
  },
  tabDotActive: {
    backgroundColor: palette.dotActive,
  },
  tabButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceRaised,
    paddingHorizontal: spacing.md,
  },
  tabButtonActive: {
    backgroundColor: palette.accent,
  },
  tabLabel: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  tabLabelActive: {
    color: palette.text,
  },
  pagerViewport: {
    overflow: 'visible',
  },
  pagerPage: {
    gap: spacing.md,
  },
  statsSection: {
    gap: spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statsTile: {
    width: '48%',
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 6,
  },
  statsLabel: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  statsValue: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  comparisonCategoryRow: {
    gap: spacing.sm,
    paddingRight: spacing.xs,
  },
  comparisonCategoryChip: {
    minHeight: 40,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  comparisonCategoryChipActive: {
    backgroundColor: palette.accent,
  },
  comparisonCategoryLabel: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  comparisonCategoryLabelActive: {
    color: palette.text,
  },
  comparisonList: {
    gap: spacing.md,
  },
  comparisonLoading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comparisonRow: {
    gap: spacing.xs,
  },
  comparisonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  comparisonPlayerLabel: {
    flex: 1,
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  comparisonValueLabel: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  comparisonBarTrack: {
    height: 12,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
    overflow: 'hidden',
  },
  comparisonBarFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: palette.accent,
  },
  gameList: {
    gap: 8,
  },
  pendingCard: {
    paddingHorizontal: 2,
    paddingVertical: 6,
    gap: 10,
  },
  pendingCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pendingSummary: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingLeft: 6,
  },
  pendingTextBlock: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    justifyContent: 'center',
    gap: 2,
  },
  pendingTitle: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  pendingError: {
    color: palette.error,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  pendingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  emptyCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  emptyBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  endDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xs,
    backgroundColor: palette.nav,
  },
  dockNote: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    fontFamily: fontFamilySans,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.overlay,
  },
  modalCard: {
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  modalTitle: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  modalBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  modalHint: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  summaryList: {
    gap: 4,
  },
  summaryLine: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  input: {
    backgroundColor: palette.field,
    color: palette.text,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fontFamilySans,
  },
  descriptionInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  cameraButtonText: {
    fontWeight: '600',
  },
  photoLibraryButton: {
    backgroundColor: palette.field,
  },
  pressed: {
    opacity: 0.9,
  },
});
