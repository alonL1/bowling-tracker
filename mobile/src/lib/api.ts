import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getExistingSessionSnapshot, supabase } from '@/lib/supabase';
import { normalizePublicAppUrl } from '@/lib/urls';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function deriveWebApiBaseUrl(envBase?: string) {
  if (typeof window === 'undefined') {
    return envBase ? normalizePublicAppUrl(envBase) : 'http://localhost:3000';
  }

  const { origin, hostname, port } = window.location;
  const isExpoDevHost =
    (hostname === 'localhost' || hostname === '127.0.0.1') && (port === '8081' || port === '19006');

  if (isExpoDevHost) {
    return envBase ? normalizePublicAppUrl(envBase) : 'http://localhost:3000';
  }

  return normalizePublicAppUrl(origin);
}

function deriveDevApiBaseUrl() {
  if (Platform.OS === 'web') {
    return deriveWebApiBaseUrl();
  }

  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as unknown as { manifest2?: { extra?: { expoGo?: { developer?: { host?: string } } } } })
      .manifest2?.extra?.expoGo?.developer?.host ||
    '';

  const host = hostUri.split(':')[0]?.trim();
  if (host) {
    return `http://${host}:3000`;
  }

  return 'http://localhost:3000';
}

export function getApiBaseUrl() {
  const envBase = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (Platform.OS === 'web') {
    return deriveWebApiBaseUrl(envBase);
  }
  if (envBase) {
    return normalizePublicAppUrl(envBase);
  }
  return deriveDevApiBaseUrl();
}

type ApiRequestInit = RequestInit & {
  authRequired?: boolean;
  accessToken?: string | null;
  timeoutMs?: number;
};

const DEFAULT_API_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  // RN's fetch has no built-in timeout; an unresponsive server can keep a
  // request hanging forever, which has caused the upload-processing queue to
  // deadlock (the `await` never resolves, `runSyncPass`'s `finally` never
  // fires, and `syncRunningRef.current` stays `true`). Wrap every call in an
  // AbortController so a stuck fetch becomes a normal rejection.
  const controller = new AbortController();
  const externalSignal = init.signal ?? null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason));
    }
  }
  const timeoutHandle = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function apiFetch(path: string, init?: ApiRequestInit) {
  const {
    authRequired = true,
    accessToken: accessTokenOverride,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    ...requestInit
  } = init ?? {};
  const sessionSnapshot = accessTokenOverride ? null : await getExistingSessionSnapshot();
  const accessToken = accessTokenOverride ?? sessionSnapshot?.accessToken ?? null;
  if (authRequired && !accessToken) {
    throw new Error('No mobile auth token is available.');
  }

  const headers = new Headers(requestInit.headers || {});
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const targetUrl = path.startsWith('http') ? path : `${getApiBaseUrl()}${path}`;
  const response = await fetchWithTimeout(targetUrl, { ...requestInit, headers }, timeoutMs);
  if (!authRequired || response.status !== 401) {
    return response;
  }

  if (accessTokenOverride) {
    return response;
  }

  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.access_token) {
    return response;
  }

  const retryHeaders = new Headers(requestInit.headers || {});
  retryHeaders.set('Authorization', `Bearer ${data.session.access_token}`);
  return fetchWithTimeout(targetUrl, { ...requestInit, headers: retryHeaders }, timeoutMs);
}

export async function parseJsonResponse<T>(response: Response) {
  const raw = await response.text();
  if (!raw) {
    return {} as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Request failed with non-JSON response (${response.status}).`);
  }
}

export async function apiJson<T>(path: string, init?: ApiRequestInit) {
  const response = await apiFetch(path, init);
  const payload = await parseJsonResponse<T & { error?: string }>(response);
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}
