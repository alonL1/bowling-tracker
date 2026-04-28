import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';

const DEFAULT_STALE_TIME = 60_000;
const DEFAULT_GC_TIME = 30 * 60_000;
const LIVE_STALE_TIME = 5_000;
const LIVE_GC_TIME = 10 * 60_000;
const STABLE_STALE_TIME = 5 * 60_000;
const STABLE_GC_TIME = 60 * 60_000;
const QUERY_PERSIST_MAX_AGE = 24 * 60 * 60_000;
export const QUERY_CACHE_OWNER_STORAGE_KEY = 'pinpoint-query-cache-owner';
const PERSISTED_QUERY_ROOT_KEYS = new Set(
  Platform.OS === 'web'
    ? ['games', 'game', 'sessions', 'leaderboard']
    : ['leaderboard'],
);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: DEFAULT_STALE_TIME,
      gcTime: DEFAULT_GC_TIME,
      refetchOnWindowFocus: false,
    },
  },
});

queryClient.setQueryDefaults(['games'], {
  staleTime: 2 * 60_000,
  gcTime: STABLE_GC_TIME,
});

queryClient.setQueryDefaults(['game'], {
  staleTime: STABLE_STALE_TIME,
  gcTime: STABLE_GC_TIME,
});

queryClient.setQueryDefaults(['sessions'], {
  staleTime: STABLE_STALE_TIME,
  gcTime: STABLE_GC_TIME,
});

queryClient.setQueryDefaults(['leaderboard'], {
  staleTime: STABLE_STALE_TIME,
  gcTime: STABLE_GC_TIME,
});

queryClient.setQueryDefaults(['live-session'], {
  staleTime: LIVE_STALE_TIME,
  gcTime: LIVE_GC_TIME,
});

queryClient.setQueryDefaults(['record-entry-status'], {
  staleTime: 10_000,
  gcTime: LIVE_GC_TIME,
});

queryClient.setQueryDefaults(['recording-draft'], {
  staleTime: LIVE_STALE_TIME,
  gcTime: LIVE_GC_TIME,
});

queryClient.setQueryDefaults(['invite-lookup'], {
  staleTime: 60_000,
  gcTime: 10 * 60_000,
});

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'pinpoint-query-cache',
  throttleTime: 1_000,
});

export const queryPersistOptions = {
  persister: queryPersister,
  maxAge: QUERY_PERSIST_MAX_AGE,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: {
      queryKey: readonly unknown[];
      state: { status: string; fetchStatus: string };
    }) => {
      const [rootKey] = query.queryKey;
      return (
        typeof rootKey === 'string' &&
        PERSISTED_QUERY_ROOT_KEYS.has(rootKey) &&
        query.state.status === 'success' &&
        query.state.fetchStatus === 'idle'
      );
    },
  },
};
