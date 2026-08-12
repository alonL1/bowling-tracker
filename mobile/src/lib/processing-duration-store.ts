import AsyncStorage from '@react-native-async-storage/async-storage';

// How long the worker takes to read a scoreboard is a server-side property, so
// these samples are not user-scoped.
const PROCESSING_DURATION_STORAGE_KEY = 'pinpoint-processing-durations-v1';
const PROCESSING_DURATION_VERSION = 1;

export const PROCESSING_DURATION_LIMIT = 30;

// Used until a device has collected enough of its own samples. This is a real
// measured median from a device running gemini-3.6-flash at high thinking, not
// a guess — re-measure it if the worker's model or thinking budget changes.
export const PROCESSING_ESTIMATE_SEED_MS = 14_500;

export const MIN_SAMPLES_FOR_MEDIAN = 5;

// Sanity bounds only. Anything genuinely slow (a Gemini retry, a requeued job)
// is kept on purpose — that tail is the interesting part of the data.
const MIN_SAMPLE_MS = 1_000;
const MAX_SAMPLE_MS = 30 * 60_000;

// Temporary instrumentation for the seed-measuring run. The `: boolean`
// annotation is deliberate: without it TypeScript infers the literal type
// `true` and reports every `false` branch as unreachable once this is flipped.
export const PROCESSING_DEBUG: boolean = true;

export type ProcessingDurationSample = {
  ms: number;
  // Games already queued or processing when this one entered processing. Lets a
  // batched sample be told apart from a single upload when picking a new seed.
  queuePosition: number;
  // The app stayed foregrounded for the whole observation. Backgrounding
  // suspends the poll, so the completion is noticed late and the duration reads
  // longer than it was.
  clean: boolean;
  // We watched this game enter processing rather than opening the screen on a
  // job that was already running.
  trusted: boolean;
  at: string;
};

type ProcessingDurationPayload = {
  version: typeof PROCESSING_DURATION_VERSION;
  updatedAt: string;
  samples: ProcessingDurationSample[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSamples(value: unknown): ProcessingDurationSample[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): ProcessingDurationSample | null => {
      if (!isRecord(entry)) {
        return null;
      }
      const ms = typeof entry.ms === 'number' && Number.isFinite(entry.ms) ? entry.ms : null;
      if (ms === null || ms < MIN_SAMPLE_MS || ms > MAX_SAMPLE_MS) {
        return null;
      }
      return {
        ms,
        queuePosition:
          typeof entry.queuePosition === 'number' && Number.isFinite(entry.queuePosition)
            ? entry.queuePosition
            : 1,
        clean: entry.clean !== false,
        trusted: entry.trusted !== false,
        at: typeof entry.at === 'string' ? entry.at : new Date().toISOString(),
      };
    })
    .filter((entry): entry is ProcessingDurationSample => entry !== null)
    .slice(-PROCESSING_DURATION_LIMIT);
}

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export type ProcessingEstimate = {
  estimateMs: number;
  source: 'seed' | 'median';
  usableSampleCount: number;
  samples: ProcessingDurationSample[];
};

function buildEstimate(samples: ProcessingDurationSample[]): ProcessingEstimate {
  const usable = samples.filter((sample) => sample.clean && sample.trusted);
  const usableMedian =
    usable.length >= MIN_SAMPLES_FOR_MEDIAN ? median(usable.map((sample) => sample.ms)) : null;

  return {
    estimateMs: usableMedian ?? PROCESSING_ESTIMATE_SEED_MS,
    source: usableMedian === null ? 'seed' : 'median',
    usableSampleCount: usable.length,
    samples,
  };
}

// In-memory mirror so the progress bar can read the estimate synchronously on
// mount, and so the debug card can update as samples land.
let cachedEstimate: ProcessingEstimate = buildEstimate([]);
let loadPromise: Promise<ProcessingEstimate> | null = null;
const listeners = new Set<(estimate: ProcessingEstimate) => void>();

function publish(samples: ProcessingDurationSample[]) {
  cachedEstimate = buildEstimate(samples);
  listeners.forEach((listener) => listener(cachedEstimate));
  return cachedEstimate;
}

export function getProcessingEstimate() {
  return cachedEstimate;
}

export function subscribeToProcessingEstimate(listener: (estimate: ProcessingEstimate) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadProcessingDurations(): Promise<ProcessingEstimate> {
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(PROCESSING_DURATION_STORAGE_KEY);
      if (!raw) {
        return publish([]);
      }
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.version !== PROCESSING_DURATION_VERSION) {
        return publish([]);
      }
      return publish(normalizeSamples(parsed.samples));
    } catch (error) {
      console.error('Failed to load processing durations.', error);
      return publish([]);
    }
  })();

  return loadPromise;
}

export async function recordProcessingDuration(sample: ProcessingDurationSample) {
  if (!Number.isFinite(sample.ms) || sample.ms < MIN_SAMPLE_MS || sample.ms > MAX_SAMPLE_MS) {
    return;
  }

  await loadProcessingDurations();
  const next = normalizeSamples([...cachedEstimate.samples, sample]);
  publish(next);

  const payload: ProcessingDurationPayload = {
    version: PROCESSING_DURATION_VERSION,
    updatedAt: new Date().toISOString(),
    samples: next,
  };

  try {
    await AsyncStorage.setItem(PROCESSING_DURATION_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to save processing duration.', error);
  }
}

export async function clearProcessingDurations() {
  publish([]);
  try {
    await AsyncStorage.removeItem(PROCESSING_DURATION_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear processing durations.', error);
  }
}
