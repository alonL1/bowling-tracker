import { useCallback, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchGameById, fetchGames, queryKeys } from '@/lib/backend';
import { loadLocalGame, loadLocalGames, loadLocalSyncMeta, localLogsSupported } from '@/lib/local-logs-db';
import { syncLocalLogsForUser } from '@/lib/local-logs-sync';
import { mergeGamesWithUploadsProcessing } from '@/lib/uploads-processing-store';
import { useAuth } from '@/providers/auth-provider';
import { useUploadsProcessing } from '@/providers/uploads-processing-provider';

export const localLogQueryKeys = {
  games: (userId: string) => ['local-logs', 'games', userId] as const,
  gameRoot: (userId: string) => ['local-logs', 'game', userId] as const,
  game: (userId: string, gameId: string) => ['local-logs', 'game', userId, gameId] as const,
  meta: (userId: string) => ['local-logs', 'meta', userId] as const,
  sync: (userId: string) => ['local-logs', 'sync', userId] as const,
};

function isMobileLocalLogs() {
  return Platform.OS !== 'web' && localLogsSupported;
}

function getOfflineLabel(error: unknown, hasLocalData: boolean, lastSuccessAt?: string | null) {
  if (error && hasLocalData) {
    return 'Offline · showing saved logs';
  }

  if (lastSuccessAt) {
    const parsed = new Date(lastSuccessAt);
    if (!Number.isNaN(parsed.getTime())) {
      return `Last synced ${parsed.toLocaleDateString('en-US')} ${parsed.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })}`;
    }
  }

  return null;
}

export function useLoggedDataSync() {
  const queryClient = useQueryClient();
  const { user, session } = useAuth();
  const userId = user?.id ?? '';
  const mobile = isMobileLocalLogs();

  const syncQuery = useQuery({
    queryKey: localLogQueryKeys.sync(userId),
    queryFn: async () => {
      const result = await syncLocalLogsForUser(userId, session?.access_token ?? null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: localLogQueryKeys.games(userId) }),
        queryClient.invalidateQueries({ queryKey: localLogQueryKeys.gameRoot(userId) }),
        queryClient.invalidateQueries({ queryKey: localLogQueryKeys.meta(userId) }),
      ]);
      return result;
    },
    enabled: mobile && Boolean(userId),
    retry: false,
    staleTime: 60_000,
  });

  const syncNow = useCallback(async () => {
    if (!mobile || !userId) {
      return;
    }

    await syncLocalLogsForUser(userId, session?.access_token ?? null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: localLogQueryKeys.games(userId) }),
      queryClient.invalidateQueries({ queryKey: localLogQueryKeys.gameRoot(userId) }),
      queryClient.invalidateQueries({ queryKey: localLogQueryKeys.meta(userId) }),
    ]);
  }, [mobile, queryClient, session?.access_token, userId]);

  return {
    ...syncQuery,
    syncNow,
  };
}

export function useLoggedGames() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { store } = useUploadsProcessing();
  const userId = user?.id ?? '';
  const mobile = isMobileLocalLogs();
  const sync = useLoggedDataSync();

  const apiQuery = useQuery({
    queryKey: queryKeys.games,
    queryFn: fetchGames,
    enabled: !mobile,
  });

  const localQuery = useQuery({
    queryKey: localLogQueryKeys.games(userId),
    queryFn: () => loadLocalGames(userId),
    enabled: mobile && Boolean(userId),
  });

  const metaQuery = useQuery({
    queryKey: localLogQueryKeys.meta(userId),
    queryFn: () => loadLocalSyncMeta(userId),
    enabled: mobile && Boolean(userId),
  });

  useEffect(() => {
    if (!mobile || !userId || !sync.isSuccess) {
      return;
    }

    void Promise.all([
      queryClient.invalidateQueries({ queryKey: localLogQueryKeys.games(userId) }),
      queryClient.invalidateQueries({ queryKey: localLogQueryKeys.gameRoot(userId) }),
      queryClient.invalidateQueries({ queryKey: localLogQueryKeys.meta(userId) }),
    ]);
  }, [mobile, queryClient, sync.isSuccess, userId]);

  const localGames = localQuery.data ?? [];
  const mergedLocalGames = useMemo(
    () => mergeGamesWithUploadsProcessing(localGames, store),
    [localGames, store],
  );
  const hasLocalData = mergedLocalGames.length > 0;

  if (!mobile) {
    return {
      data: apiQuery.data,
      games: apiQuery.data?.games ?? [],
      isPending: apiQuery.isPending,
      isFetching: apiQuery.isFetching,
      error: apiQuery.error,
      syncError: null,
      statusLabel: null,
      needsOnlineFirst: false,
      refetch: apiQuery.refetch,
    };
  }

  const syncError = sync.error;
  const isInitialSyncing = sync.isFetching && !hasLocalData;
  const data = useMemo(
    () => ({
      games: mergedLocalGames,
      count: mergedLocalGames.length,
    }),
    [mergedLocalGames],
  );
  const refetch = useCallback(async () => {
    await sync.syncNow();
    return { data } as const;
  }, [data, sync.syncNow]);

  return {
    data,
    games: mergedLocalGames,
    isPending: localQuery.isPending || isInitialSyncing,
    isFetching: localQuery.isFetching || sync.isFetching,
    error: localQuery.error ?? syncError,
    syncError,
    statusLabel: getOfflineLabel(syncError, hasLocalData, metaQuery.data?.last_success_at),
    needsOnlineFirst: Boolean(
      syncError &&
        !hasLocalData &&
        !sync.isFetching &&
        !metaQuery.data?.last_success_at,
    ),
    refetch,
  };
}

export function useLoggedGame(gameId?: string | null) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const mobile = isMobileLocalLogs();
  const sync = useLoggedDataSync();

  const apiQuery = useQuery({
    queryKey: queryKeys.game(gameId ?? ''),
    queryFn: () => fetchGameById(gameId ?? ''),
    enabled: !mobile && Boolean(gameId),
  });

  const localQuery = useQuery({
    queryKey: localLogQueryKeys.game(userId, gameId ?? ''),
    queryFn: () => loadLocalGame(userId, gameId ?? ''),
    enabled: mobile && Boolean(userId && gameId),
  });

  useEffect(() => {
    if (!mobile || !userId || !gameId || !sync.isSuccess) {
      return;
    }

    void queryClient.invalidateQueries({ queryKey: localLogQueryKeys.game(userId, gameId) });
  }, [gameId, mobile, queryClient, sync.isSuccess, userId]);

  if (!mobile) {
    return {
      data: apiQuery.data,
      game: apiQuery.data?.game ?? null,
      isPending: apiQuery.isPending,
      isFetching: apiQuery.isFetching,
      error: apiQuery.error,
      syncError: null,
      needsOnlineFirst: false,
      refetch: apiQuery.refetch,
    };
  }

  const game = localQuery.data ?? null;
  const syncError = sync.error;
  const refetch = useCallback(async () => {
    await sync.syncNow();
    return { data: game ? { game } : undefined } as const;
  }, [game, sync.syncNow]);

  return {
    data: game ? { game } : undefined,
    game,
    isPending: localQuery.isPending || (sync.isFetching && !game),
    isFetching: localQuery.isFetching || sync.isFetching,
    error: localQuery.error ?? syncError,
    syncError,
    needsOnlineFirst: Boolean(syncError && !game && !sync.isFetching),
    refetch,
  };
}
