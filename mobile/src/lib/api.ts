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
};

export async function apiFetch(path: string, init?: ApiRequestInit) {
  const { authRequired = true, accessToken: accessTokenOverride, ...requestInit } = init ?? {};
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
  const response = await fetch(targetUrl, { ...requestInit, headers });
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
  return fetch(targetUrl, { ...requestInit, headers: retryHeaders });
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
