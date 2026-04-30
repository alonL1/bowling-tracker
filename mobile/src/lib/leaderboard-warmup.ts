import type { QueryClient } from '@tanstack/react-query';

import { fetchLeaderboardMetric, queryKeys } from '@/lib/backend';
import {
  DEFAULT_LEADERBOARD_METRIC,
  getLeaderboardMetricWarmupOrder,
} from '@/lib/leaderboard';
import type { LeaderboardMetric } from '@/lib/types';

const LEADERBOARD_WARMUP_DELAY_MS = 150;

let activeLeaderboardWarmupId = 0;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function prefetchLeaderboardMetric(queryClient: QueryClient, metric: LeaderboardMetric) {
  await queryClient.prefetchQuery({
    queryKey: queryKeys.leaderboardMetric(metric),
    queryFn: () => fetchLeaderboardMetric(metric),
    retry: false,
  });
}

export function startLeaderboardMetricWarmup(
  queryClient: QueryClient,
  anchorMetric: LeaderboardMetric = DEFAULT_LEADERBOARD_METRIC,
) {
  const warmupId = activeLeaderboardWarmupId + 1;
  activeLeaderboardWarmupId = warmupId;

  void (async () => {
    const metricOrder = getLeaderboardMetricWarmupOrder(anchorMetric);

    for (const metric of metricOrder) {
      if (activeLeaderboardWarmupId !== warmupId) {
        return;
      }

      try {
        await prefetchLeaderboardMetric(queryClient, metric);
      } catch {
        // Individual tab failures are surfaced by the visible query when that tab is opened.
      }

      if (activeLeaderboardWarmupId !== warmupId) {
        return;
      }

      await wait(LEADERBOARD_WARMUP_DELAY_MS);
    }
  })();

  return () => {
    if (activeLeaderboardWarmupId === warmupId) {
      activeLeaderboardWarmupId += 1;
    }
  };
}

export function cancelLeaderboardMetricWarmup() {
  activeLeaderboardWarmupId += 1;
}
