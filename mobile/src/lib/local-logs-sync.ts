import { fetchMobileLogsSync } from '@/lib/backend';
import {
  applyLocalLogsSync,
  loadLocalSyncMeta,
  localLogsSupported,
} from '@/lib/local-logs-db';

const inFlightSyncs = new Map<string, Promise<{ lastSuccessAt: string | null }>>();

export async function syncLocalLogsForUser(userId: string, accessToken?: string | null) {
  if (!localLogsSupported) {
    return { lastSuccessAt: null };
  }

  const inFlight = inFlightSyncs.get(userId);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    const meta = await loadLocalSyncMeta(userId);
    const payload = await fetchMobileLogsSync(meta?.logs_cursor ?? null, accessToken);
    await applyLocalLogsSync(userId, payload);
    const nextMeta = await loadLocalSyncMeta(userId);
    return { lastSuccessAt: nextMeta?.last_success_at ?? null };
  })();

  inFlightSyncs.set(userId, task);
  try {
    return await task;
  } finally {
    inFlightSyncs.delete(userId);
  }
}
