import type { LeaderboardMetric } from '@/lib/types';

export const DEFAULT_LEADERBOARD_METRIC: LeaderboardMetric = 'bestGame';

export const LEADERBOARD_METRIC_ORDER: readonly LeaderboardMetric[] = [
  'bestGame',
  'bestAverage',
  'bestSeries',
  'bestSession',
  'StrikeRate',
  'SpareRate',
  'TotalStrikes',
  'TotalSpares',
  'mostGames',
  'mostSessions',
  'SessionScore',
  'TotalPoints',
  'SessionLength',
  'MostNines',
];

function getMetricIndex(metric: LeaderboardMetric) {
  const index = LEADERBOARD_METRIC_ORDER.indexOf(metric);
  return index >= 0 ? index : 0;
}

export function getLeaderboardMetricWarmupOrder(
  anchorMetric: LeaderboardMetric = DEFAULT_LEADERBOARD_METRIC,
) {
  const anchorIndex = getMetricIndex(anchorMetric);

  return [...LEADERBOARD_METRIC_ORDER].sort((leftMetric, rightMetric) => {
    const leftIndex = getMetricIndex(leftMetric);
    const rightIndex = getMetricIndex(rightMetric);
    const distanceDelta =
      Math.abs(leftIndex - anchorIndex) - Math.abs(rightIndex - anchorIndex);

    return distanceDelta || leftIndex - rightIndex;
  });
}
