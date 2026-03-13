import type * as ImagePicker from 'expo-image-picker';

const AUTO_SESSION_GAP_MS = 2 * 60 * 60 * 1000;

function parseExifDate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.includes(':') && trimmed.includes(' ')
    ? trimmed.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T')
    : trimmed;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function deriveCapturedAtHint(asset: ImagePicker.ImagePickerAsset) {
  const exif = asset.exif as Record<string, unknown> | null | undefined;
  const exifValue =
    parseExifDate(exif?.DateTimeOriginal) ||
    parseExifDate(exif?.CreateDate) ||
    parseExifDate(exif?.DateTimeDigitized) ||
    parseExifDate(exif?.ModifyDate) ||
    parseExifDate(exif?.DateTime);

  return exifValue || new Date().toISOString();
}

export function buildAutoGroupMap(assets: ImagePicker.ImagePickerAsset[]) {
  const ordered = assets
    .map((asset, index) => ({
      asset,
      index,
      capturedAtHint: deriveCapturedAtHint(asset),
    }))
    .sort((left, right) => {
      const timeDelta = Date.parse(left.capturedAtHint) - Date.parse(right.capturedAtHint);
      if (timeDelta !== 0) {
        return timeDelta;
      }
      return left.index - right.index;
    });

  let currentGroup = 0;
  let previousTime = 0;
  const groupByAssetUri = new Map<string, { capturedAtHint: string; autoGroupIndex: number }>();

  ordered.forEach((entry, index) => {
    const nextTime = Date.parse(entry.capturedAtHint);
    if (index === 0) {
      currentGroup = 0;
    } else if (nextTime - previousTime > AUTO_SESSION_GAP_MS) {
      currentGroup += 1;
    }

    previousTime = nextTime;
    groupByAssetUri.set(entry.asset.uri, {
      capturedAtHint: entry.capturedAtHint,
      autoGroupIndex: currentGroup,
    });
  });

  return groupByAssetUri;
}

export function sanitizeFilename(name: string | undefined, fallbackIndex: number) {
  const source = name?.trim() || `scoreboard-${fallbackIndex + 1}.jpg`;
  return source.replace(/[^a-zA-Z0-9._-]/g, '-');
}
