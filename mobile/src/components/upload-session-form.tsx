import * as ImagePicker from 'expo-image-picker';
import { File as ExpoFile } from 'expo-file-system';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import ActionButton from '@/components/action-button';
import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import InfoBanner from '@/components/info-banner';
import SurfaceCard from '@/components/surface-card';
import {
  fetchGames,
  fetchStatus,
  queryKeys,
  submitGames,
} from '@/lib/backend';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { buildSessionGroups } from '@/lib/bowling';
import { supabase } from '@/lib/supabase';
import type { SessionMode } from '@/lib/types';
import { buildAutoGroupMap, sanitizeFilename } from '@/lib/upload';
import { useAuth } from '@/providers/auth-provider';

const DEFAULT_BUCKET = 'scoreboards-temp';
const MAX_IMAGE_COUNT = 100;

type UploadSessionFormProps = {
  title: string;
  playerLabel: string;
  imageLabel: string;
  helperText: string;
  sessionMode: SessionMode;
  addToLogHelperText?: string;
  requireExistingSession?: boolean;
};

type PendingJob = {
  jobId: string;
  message: string;
  status: string;
  lastError?: string | null;
  gameId?: string;
};

type RecentLoggedGame = {
  id: string;
  label: string;
};

async function getUploadBody(asset: ImagePicker.ImagePickerAsset) {
  if (asset.file) {
    return asset.file;
  }

  const file = new ExpoFile(asset.uri);
  return file.arrayBuffer();
}

export default function UploadSessionForm({
  title,
  playerLabel,
  imageLabel,
  helperText,
  sessionMode,
  addToLogHelperText,
  requireExistingSession = false,
}: UploadSessionFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [playerName, setPlayerName] = useState('');
  const [selectedAssets, setSelectedAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [pendingJobs, setPendingJobs] = useState<PendingJob[]>([]);
  const [recentLoggedGames, setRecentLoggedGames] = useState<RecentLoggedGame[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');

  const sessionsQuery = useQuery({
    queryKey: queryKeys.games,
    queryFn: fetchGames,
    enabled: requireExistingSession,
  });

  const sessionOptions = useMemo(
    () =>
      buildSessionGroups(sessionsQuery.data?.games ?? []).groups
        .filter((group) => !group.isSessionless && Boolean(group.sessionId))
        .map((group) => ({
          id: group.sessionId as string,
          title: group.title,
        })),
    [sessionsQuery.data?.games],
  );

  React.useEffect(() => {
    if (!requireExistingSession) {
      return;
    }
    if (selectedSessionId) {
      return;
    }
    if (sessionOptions.length > 0) {
      setSelectedSessionId(sessionOptions[0].id);
    }
  }, [requireExistingSession, selectedSessionId, sessionOptions]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!user) {
        throw new Error('You must have a mobile session before uploading.');
      }
      if (selectedAssets.length === 0) {
        throw new Error('Pick at least one scoreboard image.');
      }
      if (!playerName.trim()) {
        throw new Error('Player name is required.');
      }
      if (requireExistingSession && !selectedSessionId) {
        throw new Error('Choose an existing session.');
      }

      setPendingJobs([]);
      setRecentLoggedGames([]);
      setStatusMessage('');

      const autoGroupMap = sessionMode === 'auto' ? buildAutoGroupMap(selectedAssets) : new Map();
      const storageItems: Array<{
        storageKey: string;
        capturedAtHint?: string;
        fileSizeBytes?: number;
        autoGroupIndex?: number;
      }> = [];

      for (let index = 0; index < selectedAssets.length; index += 1) {
        const asset = selectedAssets[index];
        const filename = sanitizeFilename(asset.fileName ?? undefined, index);
        const storageKey = `${user.id}/${Date.now()}-${index}-${filename}`;

        let uploadBody: ArrayBuffer | File;
        try {
          uploadBody = await getUploadBody(asset);
        } catch {
          continue;
        }

        const upload = await supabase.storage.from(DEFAULT_BUCKET).upload(storageKey, uploadBody, {
          contentType: asset.mimeType ?? 'image/jpeg',
          upsert: false,
        });
        if (upload.error) {
          continue;
        }

        const autoMeta = autoGroupMap.get(asset.uri);
        storageItems.push({
          storageKey,
          capturedAtHint: autoMeta?.capturedAtHint,
          autoGroupIndex: sessionMode === 'auto' ? autoMeta?.autoGroupIndex : undefined,
          fileSizeBytes: asset.fileSize,
        });
      }

      if (storageItems.length === 0) {
        throw new Error('All uploads failed before they could be submitted.');
      }

      const submitResponse = await submitGames({
        playerName: playerName.trim(),
        timezoneOffsetMinutes: String(new Date().getTimezoneOffset()),
        sessionMode,
        existingSessionId: requireExistingSession ? selectedSessionId ?? undefined : undefined,
        storageItems,
      });

      const nextJobs = (submitResponse.jobs ?? []).map((job) => ({
        jobId: job.jobId,
        message: job.message,
        status: job.status,
      }));
      setPendingJobs(nextJobs);

      const completedGameIds = new Set<string>();
      const unresolved = new Set(nextJobs.map((job) => job.jobId));

      for (let pollIndex = 0; pollIndex < 40 && unresolved.size > 0; pollIndex += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const snapshot = [...unresolved];
        const statuses = await Promise.all(
          snapshot.map(async (jobId) => {
            try {
              return await fetchStatus(jobId);
            } catch (nextError) {
              return {
                jobId,
                status: 'error' as const,
                lastError:
                  nextError instanceof Error ? nextError.message : 'Failed to poll job status.',
                gameId: undefined,
              };
            }
          }),
        );
        setPendingJobs((current) =>
          current.map((job) => {
            const match = statuses.find((entry) => entry.jobId === job.jobId);
            if (!match) {
              return job;
            }
            return {
              ...job,
              status: match.status,
              lastError: match.lastError,
              gameId: match.gameId,
            };
          }),
        );

        for (const status of statuses) {
          if (status.status === 'logged' || status.status === 'error') {
            unresolved.delete(status.jobId);
          }
          if (status.gameId) {
            completedGameIds.add(status.gameId);
          }
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      ]);

      const reviewIds = Array.from(completedGameIds);
      const refreshedGames = await queryClient.fetchQuery({
        queryKey: queryKeys.games,
        queryFn: fetchGames,
      });
      const refreshedGrouping = buildSessionGroups(refreshedGames.games);
      const sessionTitleByGameId = new Map<string, string>();

      refreshedGrouping.groups.forEach((sessionGroup) => {
        sessionGroup.games.forEach((game) => {
          sessionTitleByGameId.set(game.id, sessionGroup.title);
        });
      });

      setRecentLoggedGames(
        reviewIds.map((gameId) => ({
          id: gameId,
          label: `${sessionTitleByGameId.get(gameId) || 'Session'}, ${
            refreshedGrouping.gameTitleMap.get(gameId) || 'Game'
          }`,
        })),
      );
      setStatusMessage(
        reviewIds.length > 0
          ? 'Processing finished. Review the logged games below.'
          : 'Upload submitted. Some jobs may still be processing.',
      );
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to submit upload.');
    },
  });

  const handlePickImages = async () => {
    setError('');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGE_COUNT,
      exif: true,
      quality: 1,
    });

    if (result.canceled) {
      return;
    }

    setSelectedAssets(result.assets.slice(0, MAX_IMAGE_COUNT));
  };

  const jobSummary = useMemo(() => {
    const logged = pendingJobs.filter((job) => job.status === 'logged').length;
    const failed = pendingJobs.filter((job) => job.status === 'error').length;
    const active = pendingJobs.filter((job) => job.status === 'queued' || job.status === 'processing').length;
    return { logged, failed, active };
  }, [pendingJobs]);

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
        <Ionicons name="chevron-back" size={16} color={palette.muted} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>

      <SurfaceCard style={styles.formCard}>
        <Text style={styles.cardTitle}>{playerLabel}</Text>
        <Text style={styles.cardDescription}>Match the name on the scoreboard so the upload can identify your games correctly.</Text>
        <Text style={styles.label}>{playerLabel}</Text>
        <TextInput
          placeholder="Alexander, Alex, Xander"
          placeholderTextColor={palette.muted}
          style={styles.input}
          value={playerName}
          onChangeText={setPlayerName}
        />
      </SurfaceCard>

      <SurfaceCard style={styles.formCard}>
        <Text style={styles.cardTitle}>{imageLabel}</Text>
        <Text style={styles.cardDescription}>
          {selectedAssets.length > 0
            ? `${selectedAssets.length} scoreboard image(s) selected.`
            : 'Pick one or more scoreboard images from your photo library.'}
        </Text>
        <ActionButton
          label={selectedAssets.length > 0 ? 'Choose different images' : 'Choose scoreboard images'}
          onPress={handlePickImages}
          variant="secondary"
        />
      </SurfaceCard>

      {requireExistingSession ? (
        <SurfaceCard style={styles.formCard}>
          <Text style={styles.cardTitle}>Choose existing session</Text>
          {sessionsQuery.isPending ? (
            <View style={styles.sessionState}>
              <BowlingBallSpinner size={18} />
              <Text style={styles.helper}>Loading sessions...</Text>
            </View>
          ) : sessionOptions.length === 0 ? (
            <Text style={styles.helper}>No existing sessions yet.</Text>
          ) : (
            <View style={styles.sessionList}>
              {sessionOptions.map((session) => (
                <Pressable
                  key={session.id}
                  onPress={() => setSelectedSessionId(session.id)}
                  style={({ pressed }) => [
                    styles.sessionOption,
                    selectedSessionId === session.id && styles.sessionOptionActive,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.sessionOptionText, selectedSessionId === session.id && styles.sessionOptionTextActive]}>
                    {session.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </SurfaceCard>
      ) : null}

      <InfoBanner text={helperText} />

      {error ? <InfoBanner text={error} tone="error" /> : null}
      {statusMessage ? <InfoBanner text={statusMessage} /> : null}

      <ActionButton
        label={submitMutation.isPending ? 'Adding to Log...' : 'Add to Log'}
        onPress={() => submitMutation.mutate()}
        disabled={
          submitMutation.isPending ||
          selectedAssets.length === 0 ||
          !playerName.trim() ||
          (requireExistingSession && !selectedSessionId)
        }
      />

      {addToLogHelperText ? <InfoBanner text={addToLogHelperText} /> : null}

      {pendingJobs.length > 0 ? (
        <SurfaceCard style={styles.jobsCard}>
          <Text style={styles.jobsTitle}>
            Jobs: {jobSummary.logged} logged, {jobSummary.active} active, {jobSummary.failed} failed
          </Text>
          <View style={styles.jobsList}>
            {pendingJobs.map((job) => (
              <View key={job.jobId} style={styles.jobRow}>
                <Text style={styles.jobText}>{job.message}</Text>
                <Text style={styles.jobStatus}>{job.status}</Text>
                {job.lastError ? <Text style={styles.errorText}>{job.lastError}</Text> : null}
              </View>
            ))}
          </View>
        </SurfaceCard>
      ) : null}

      {recentLoggedGames.length > 0 ? (
        <SurfaceCard style={styles.jobsCard}>
          <Text style={styles.jobsTitle}>Review logged games</Text>
          <View style={styles.jobsList}>
            {recentLoggedGames.map((game) => (
              <Pressable
                key={game.id}
                onPress={() => {
                  router.push({
                    pathname: '/games/[gameId]',
                    params: { gameId: game.id },
                  });
                }}
                style={({ pressed }) => [styles.reviewButton, pressed && styles.pressed]}>
                <Text style={styles.reviewButtonText}>{game.label}</Text>
              </Pressable>
            ))}
          </View>
        </SurfaceCard>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 132,
    gap: spacing.lg,
  },
  backButton: {
    alignSelf: 'flex-start',
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
  title: {
    color: palette.text,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  formCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  cardDescription: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  label: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
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
  helper: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  errorText: {
    color: palette.error,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  jobsCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  jobsTitle: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  jobsList: {
    gap: spacing.sm,
  },
  jobRow: {
    gap: 4,
  },
  jobText: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  jobStatus: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
    textTransform: 'capitalize',
  },
  reviewButton: {
    backgroundColor: palette.field,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  reviewButtonText: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  sessionState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sessionList: {
    gap: spacing.sm,
  },
  sessionOption: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  sessionOptionActive: {
    backgroundColor: palette.accent,
  },
  sessionOptionText: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  sessionOptionTextActive: {
    color: palette.text,
  },
  pressed: {
    opacity: 0.9,
  },
});
