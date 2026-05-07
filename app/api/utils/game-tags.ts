export const ALLOWED_GAME_TAGS = ["warmup", "league", "tournament"] as const;
export type GameTag = (typeof ALLOWED_GAME_TAGS)[number];

export function normalizeGameTags(input: unknown): GameTag[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const set = new Set<GameTag>();
  for (const value of input) {
    if (
      typeof value === "string" &&
      (ALLOWED_GAME_TAGS as readonly string[]).includes(value)
    ) {
      set.add(value as GameTag);
    }
  }
  return [...set];
}
