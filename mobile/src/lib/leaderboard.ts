import { formatTenths } from '@/lib/number-format';
import type { LeaderboardMetric, LeaderboardRange } from '@/lib/types';

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

export const LEADERBOARD_METRIC_DETAILS: Record<
  LeaderboardMetric,
  {
    label: string;
    description: string;
  }
> = {
  bestGame: { label: 'Score', description: 'Highest Scoring Game' },
  bestAverage: { label: 'Average', description: 'Average Score Across All Games' },
  bestSeries: { label: 'Series', description: 'Best 3 Games Series' },
  bestSession: { label: 'Best Session', description: 'Best Single Session Average Score' },
  StrikeRate: { label: 'Strike Rate', description: 'Strike Rate' },
  SpareRate: { label: 'Spare Rate', description: 'Spare Conversion Rate' },
  TotalStrikes: { label: 'Strikes', description: 'Total Number of Strikes' },
  TotalSpares: { label: 'Spares', description: 'Total Number of Spares' },
  mostGames: { label: 'Games', description: 'Total Games Logged' },
  mostSessions: { label: 'Sessions', description: 'Total Sessions Logged' },
  SessionScore: { label: 'Session Score', description: 'Most Points Scored in a Session' },
  TotalPoints: { label: 'Points', description: 'Total Points Across All Games' },
  SessionLength: { label: 'Session Length', description: 'Most Games Played in a Session' },
  MostNines: { label: '9 King', description: 'Total Frames with Score of 9' },
};

export const LEADERBOARD_RANGE_LABELS: Record<LeaderboardRange, string> = {
  allTime: 'All time',
  last30: 'Last 30 days',
};

// Every leaderboard metric ranks descending on the server, so higher always wins.
// If a lower-is-better metric is ever added, both the API sort and the friend
// comparison modal need a per-metric direction map.
export function formatLeaderboardMetricValue(metric: LeaderboardMetric, value: number) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (metric === 'bestAverage' || metric === 'bestSession') {
    return formatTenths(value);
  }
  if (metric === 'bestSeries') {
    return Math.round(value).toLocaleString();
  }
  if (metric === 'StrikeRate' || metric === 'SpareRate') {
    return `${formatTenths(value)}%`;
  }
  return Math.round(value).toLocaleString();
}

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
