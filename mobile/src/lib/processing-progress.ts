import { AppState } from 'react-native';

import { recordProcessingDuration } from '@/lib/processing-duration-store';

// Anchors live at module scope rather than in component state on purpose: the
// draft list is a DraggableFlatList, so VirtualizedList windowing unmounts
// off-screen rows. A remounted bar has to resume at real elapsed time instead of
// restarting from zero.
type ProcessingAnchor = {
  startedAt: number;
  queuePosition: number;
  trusted: boolean;
  clean: boolean;
};

const ANCHOR_LIMIT = 200;
const ANCHOR_EVICT_COUNT = 100;

const anchors = new Map<string, ProcessingAnchor>();

// Scopes that have committed at least once. A game whose anchor is created on a
// scope's very first commit was already processing when the screen opened, so we
// never saw it start and its duration would be short by an unknown amount.
const renderedScopes = new Set<string>();

// The worker keeps going while the app is backgrounded, but the 2.5s poll does
// not — so a completion observed after a background gap reads longer than it
// really was. Mark every in-flight anchor dirty instead of trying to correct it.
AppState.addEventListener('change', (nextState) => {
  if (nextState === 'active') {
    return;
  }
  anchors.forEach((anchor) => {
    anchor.clean = false;
  });
});

function evictOldestAnchors() {
  if (anchors.size <= ANCHOR_LIMIT) {
    return;
  }
  // Map preserves insertion order, so the first keys are the oldest.
  Array.from(anchors.keys())
    .slice(0, ANCHOR_EVICT_COUNT)
    .forEach((key) => anchors.delete(key));
}

export function markScopeRendered(scope: string) {
  renderedScopes.add(scope);
}

export function ensureProcessingAnchor(scope: string, gameId: string, queuePosition: number) {
  const existing = anchors.get(gameId);
  if (existing) {
    return existing;
  }

  const anchor: ProcessingAnchor = {
    startedAt: Date.now(),
    queuePosition: Math.max(1, queuePosition),
    trusted: renderedScopes.has(scope),
    clean: AppState.currentState === 'active',
  };
  anchors.set(gameId, anchor);
  evictOldestAnchors();
  return anchor;
}

export function getProcessingElapsedMs(gameId: string) {
  const anchor = anchors.get(gameId);
  return anchor ? Date.now() - anchor.startedAt : 0;
}

export function dropProcessingAnchor(gameId: string) {
  anchors.delete(gameId);
}

// Called by the screens, not the bar: the pending card unmounts the instant the
// game flips to `ready`, so the bar never observes its own completion.
export function completeProcessingAnchor(gameId: string) {
  const anchor = anchors.get(gameId);
  if (!anchor) {
    return;
  }
  anchors.delete(gameId);

  void recordProcessingDuration({
    ms: Date.now() - anchor.startedAt,
    queuePosition: anchor.queuePosition,
    clean: anchor.clean,
    trusted: anchor.trusted,
    at: new Date().toISOString(),
  });
}
