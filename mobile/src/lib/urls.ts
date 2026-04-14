const CANONICAL_PUBLIC_APP_ORIGIN = 'https://bowling-tracker-six.vercel.app';
const DEPRECATED_PUBLIC_APP_ORIGINS = new Map<string, string>([
  ['https://pinpointbowling.vercel.app', CANONICAL_PUBLIC_APP_ORIGIN],
]);

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export const PUBLIC_WEBSITE_URL = CANONICAL_PUBLIC_APP_ORIGIN;

export function normalizePublicAppUrl(value: string) {
  const trimmed = trimTrailingSlash(value.trim());
  if (!trimmed) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const replacementOrigin = DEPRECATED_PUBLIC_APP_ORIGINS.get(trimTrailingSlash(parsed.origin));
    if (!replacementOrigin) {
      return trimTrailingSlash(parsed.toString());
    }

    const normalized = new URL(parsed.pathname + parsed.search + parsed.hash, replacementOrigin);
    return trimTrailingSlash(normalized.toString());
  } catch {
    return trimmed;
  }
}
