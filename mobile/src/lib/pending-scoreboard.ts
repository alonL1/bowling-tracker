import type { LocalSyncMetadata } from '@/lib/types';

// A pending scoreboard is either still on its way to the server or already
// being read by the worker. Both game cards derive this once and use it for the
// label and the progress bar, so the two can never disagree.
export type PendingScoreboardPhase = 'uploading' | 'processing' | 'error';

type PendingScoreboardGame = {
  status: string;
  local_sync?: LocalSyncMetadata | null;
};

// `local_sync` is the "has not reached the server yet" signal: the merge
// functions in uploads-processing-store.ts strip it from every server row, and
// a local-only game gets its server id and `processing_pending` status in the
// same store update, so it can never hold a server id while still `queued`.
//
// Caveat: `uploading` also covers `uploaded` / `server_row_pending` (sub-second,
// harmless) and `captured_local`, which in a large batch can sit waiting its
// turn in the serial sync pass. Narrowing that further would need a per-game
// capture-store lookup, which is not worth coupling the cards to the provider.
export function getPendingScoreboardPhase(game: PendingScoreboardGame): PendingScoreboardPhase {
  if (game.status === 'error') {
    return 'error';
  }
  if (game.local_sync && game.status === 'queued') {
    return 'uploading';
  }
  return 'processing';
}

export function getPendingScoreboardLabel(phase: PendingScoreboardPhase) {
  if (phase === 'error') {
    return 'Scoreboard needs attention';
  }
  return phase === 'uploading' ? 'Uploading scoreboard' : 'Processing scoreboard';
}
