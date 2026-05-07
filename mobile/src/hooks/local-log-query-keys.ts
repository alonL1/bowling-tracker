export const localLogQueryKeys = {
  games: (userId: string) => ['local-logs', 'games', userId] as const,
  gameRoot: (userId: string) => ['local-logs', 'game', userId] as const,
  game: (userId: string, gameId: string) => ['local-logs', 'game', userId, gameId] as const,
  meta: (userId: string) => ['local-logs', 'meta', userId] as const,
  sync: (userId: string) => ['local-logs', 'sync', userId] as const,
};
