"use client";

import { useEffect, useState } from "react";
import exifr from "exifr";
import {
  authFetch,
  getAccessToken,
  getCurrentUser,
  supabase
} from "../lib/authClient";

type SubmitState = "idle" | "submitting" | "queued" | "error";
type SessionMode = "auto" | "new" | "existing";

type SubmitResponse = {
  jobs?: QueuedJob[];
  errors?: string[];
};

type QueuedJob = {
  jobId: string;
  message: string;
};

type SessionOption = {
  id: string;
  label: string;
};

type UploadFormProps = {
  onQueued?: (jobs: QueuedJob[]) => void;
  onError?: (message: string) => void;
  pendingJobsCount?: number;
  sessions?: SessionOption[];
  isSessionsLoading?: boolean;
  sessionMode?: SessionMode;
  onSessionModeChange?: (mode: SessionMode) => void;
  selectedExistingSessionId?: string | null;
  onExistingSessionChange?: (sessionId: string | null) => void;
  modeSelectorVisible?: boolean;
  existingSessionSelectorVisible?: boolean;
  nameLabel?: string;
  namePlaceholder?: string;
  imageLabel?: string;
  submitHelperText?: string | null;
  className?: string;
};

type DerivedImage = {
  file: File;
  capturedAtHint: string;
  autoGroupIndex: number | null;
};

type StorageItemPayload = {
  storageKey: string;
  capturedAtHint: string;
  fileSizeBytes: number;
  autoGroupIndex?: number;
};

const AUTO_SESSION_GAP_MS = 2 * 60 * 60 * 1000;
const MAX_IMAGES_PER_REQUEST = 100;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES_PER_REQUEST = 500 * 1024 * 1024;

function parseOffsetMinutes(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    const hours = Number(value[0]);
    const minutes = Number(value[1] ?? 0);
    if (!Number.isFinite(hours)) {
      return null;
    }
    return hours * 60 + (Number.isFinite(minutes) ? minutes : 0);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value * 60 : null;
  }
  const match = String(value).trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match) {
    return null;
  }
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return sign * (hours * 60 + minutes);
}

function getLocalParts(value: unknown) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return {
      year: value.getFullYear(),
      month: value.getMonth(),
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds()
    };
  }
  const normalized = String(value)
    .trim()
    .replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!match) {
    return null;
  }
  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10) - 1,
    day: Number.parseInt(match[3], 10),
    hour: match[4] ? Number.parseInt(match[4], 10) : 0,
    minute: match[5] ? Number.parseInt(match[5], 10) : 0,
    second: match[6] ? Number.parseInt(match[6], 10) : 0
  };
}

function toUtcIsoFromExif(value: unknown, offsetMinutes: number | null) {
  if (offsetMinutes === null || offsetMinutes === undefined) {
    return null;
  }
  const parts = getLocalParts(value);
  if (!parts) {
    return null;
  }
  const baseUtc = Date.UTC(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return new Date(baseUtc - offsetMinutes * 60000).toISOString();
}

function toValidIso(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = new Date(value instanceof Date ? value.getTime() : String(value));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

async function deriveCapturedAtHint(file: File, fallbackOffsetMinutes: number) {
  try {
    const buffer = await file.arrayBuffer();
    const data = await exifr.parse(buffer, {
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "DateTimeDigitized",
        "ModifyDate",
        "OffsetTimeOriginal",
        "OffsetTime",
        "OffsetTimeDigitized",
        "TimeZoneOffset"
      ]
    });

    if (data) {
      const offsetMinutes =
        parseOffsetMinutes(
          data.OffsetTimeOriginal ||
            data.OffsetTime ||
            data.OffsetTimeDigitized ||
            data.TimeZoneOffset
        ) ?? fallbackOffsetMinutes;
      const candidates = [
        data.DateTimeOriginal,
        data.CreateDate,
        data.DateTimeDigitized,
        data.ModifyDate
      ];

      for (const candidate of candidates) {
        const exifIso = toUtcIsoFromExif(candidate, offsetMinutes);
        if (exifIso) {
          return exifIso;
        }
      }
    }
  } catch (error) {
    console.warn("EXIF parse failed in UploadForm:", error);
  }

  const lastModifiedIso = toValidIso(file.lastModified);
  if (lastModifiedIso) {
    return lastModifiedIso;
  }

  return new Date().toISOString();
}

function buildAutoGroupIndices(capturedAtHints: string[]) {
  const indices = new Array<number>(capturedAtHints.length).fill(0);
  const ordered = capturedAtHints
    .map((capturedAtHint, originalIndex) => ({
      originalIndex,
      time: Date.parse(capturedAtHint)
    }))
    .sort((a, b) => {
      if (a.time !== b.time) {
        return a.time - b.time;
      }
      return a.originalIndex - b.originalIndex;
    });

  let currentGroup = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = ordered[index - 1];
    if (
      previous &&
      Number.isFinite(current.time) &&
      Number.isFinite(previous.time) &&
      current.time - previous.time > AUTO_SESSION_GAP_MS
    ) {
      currentGroup += 1;
    }
    indices[current.originalIndex] = currentGroup;
  }

  return indices;
}

export default function UploadForm({
  onQueued,
  onError,
  pendingJobsCount = 0,
  sessions = [],
  isSessionsLoading = false,
  sessionMode = "new",
  onSessionModeChange,
  selectedExistingSessionId = null,
  onExistingSessionChange,
  modeSelectorVisible = true,
  existingSessionSelectorVisible = true,
  nameLabel = "Your name(s) on the scoresheet",
  namePlaceholder = "Alexander, Alex, Xander",
  imageLabel = "Scoreboard image(s)",
  submitHelperText = null,
  className = ""
}: UploadFormProps) {
  const [status, setStatus] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string>("");
  const [jobIds, setJobIds] = useState<string[]>([]);
  const isDebug = process.env.CHAT_DEBUG === "true";
  const bucket =
    process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || "scoreboards-temp";
  const canChooseExisting = isSessionsLoading || sessions.length > 0;

  const getExtension = (file: File) => {
    const nameParts = file.name.split(".");
    if (nameParts.length > 1) {
      const ext = nameParts[nameParts.length - 1]?.trim();
      if (ext) {
        return ext.toLowerCase();
      }
    }
    if (file.type && file.type.includes("/")) {
      return file.type.split("/")[1] || "jpg";
    }
    return "jpg";
  };

  useEffect(() => {
    if (pendingJobsCount === 0 && jobIds.length > 0) {
      setStatus("idle");
      setMessage("");
      setJobIds([]);
    }
  }, [jobIds.length, pendingJobsCount]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("submitting");
    setMessage("");
    setJobIds([]);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const playerName = formData.get("playerName");
    const images = formData
      .getAll("image")
      .filter((item) => item instanceof File && item.size > 0) as File[];
    const timezoneOffsetMinutes = String(new Date().getTimezoneOffset());
    const fallbackOffsetMinutes = -new Date().getTimezoneOffset();

    const nameList =
      typeof playerName === "string"
        ? playerName
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)
        : [];

    if (nameList.length === 0) {
      const errorMessage =
        "Please enter at least one player name on the scoreboard.";
      setStatus("error");
      setMessage(errorMessage);
      onError?.(errorMessage);
      return;
    }

    if (images.length === 0) {
      const errorMessage = "Please select a scoreboard image to upload.";
      setStatus("error");
      setMessage(errorMessage);
      onError?.(errorMessage);
      return;
    }

    if (images.length > MAX_IMAGES_PER_REQUEST) {
      const errorMessage = `Please select no more than ${MAX_IMAGES_PER_REQUEST} images at once.`;
      setStatus("error");
      setMessage(errorMessage);
      onError?.(errorMessage);
      return;
    }

    const oversizedImage = images.find((image) => image.size > MAX_IMAGE_BYTES);
    if (oversizedImage) {
      const errorMessage = `Each image must be 8 MB or smaller. "${oversizedImage.name}" is too large.`;
      setStatus("error");
      setMessage(errorMessage);
      onError?.(errorMessage);
      return;
    }

    const totalBytes = images.reduce((sum, image) => sum + image.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES_PER_REQUEST) {
      const errorMessage = "This upload is too large. Keep total selected image size at or below 500 MB.";
      setStatus("error");
      setMessage(errorMessage);
      onError?.(errorMessage);
      return;
    }

    if (sessionMode === "existing" && !selectedExistingSessionId) {
      const errorMessage = "Please choose an existing session.";
      setStatus("error");
      setMessage(errorMessage);
      onError?.(errorMessage);
      return;
    }

    try {
      if (!supabase) {
        throw new Error("Supabase client not configured.");
      }
      await getAccessToken();
      const currentUser = await getCurrentUser();
      const currentUserId = currentUser?.id;
      if (!currentUserId) {
        throw new Error("Unable to resolve current user session.");
      }

      const normalizedNames = nameList.join(", ");
      const uploadErrors: string[] = [];
      const derivedImages: DerivedImage[] = [];

      for (const image of images) {
        const capturedAtHint = await deriveCapturedAtHint(
          image,
          fallbackOffsetMinutes
        );
        derivedImages.push({
          file: image,
          capturedAtHint,
          autoGroupIndex: null
        });
      }

      if (sessionMode === "auto") {
        const autoGroupIndices = buildAutoGroupIndices(
          derivedImages.map((item) => item.capturedAtHint)
        );
        autoGroupIndices.forEach((groupIndex, index) => {
          derivedImages[index].autoGroupIndex = groupIndex;
        });
      }

      const storageItems: StorageItemPayload[] = [];

      for (const image of derivedImages) {
        const extension = getExtension(image.file);
        const storageKey = `${currentUserId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storageKey, image.file, {
            contentType: image.file.type || "image/jpeg",
            upsert: false
          });
        if (uploadError) {
          uploadErrors.push(uploadError.message || "Failed to upload image.");
          continue;
        }
        storageItems.push({
          storageKey,
          capturedAtHint: image.capturedAtHint,
          fileSizeBytes: image.file.size,
          ...(sessionMode === "auto" && image.autoGroupIndex !== null
            ? { autoGroupIndex: image.autoGroupIndex }
            : {})
        });
      }

      if (storageItems.length === 0) {
        const messageText =
          uploadErrors[0] || "Failed to upload any scoreboard images.";
        setStatus("error");
        setMessage(messageText);
        onError?.(messageText);
        return;
      }

      const response = await authFetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: normalizedNames,
          timezoneOffsetMinutes,
          sessionMode,
          existingSessionId:
            sessionMode === "existing" ? selectedExistingSessionId : undefined,
          storageItems
        })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Submission failed.");
      }

      const payload = (await response.json()) as SubmitResponse;
      const queuedJobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      const errors = [...(payload.errors || []), ...uploadErrors];

      if (queuedJobs.length === 0) {
        const messageText = errors[0] || "Submission failed.";
        setStatus("error");
        setMessage(messageText);
        onError?.(messageText);
        return;
      }

      const queuedMessage = isDebug
        ? `Queued ${queuedJobs.length} job${
            queuedJobs.length === 1 ? "" : "s"
          } for extraction.`
        : `Queued ${queuedJobs.length} game${
            queuedJobs.length === 1 ? "" : "s"
          } for review.`;
      const errorSuffix = errors.length
        ? isDebug
          ? ` ${errors.length} upload${errors.length === 1 ? "" : "s"} failed.`
          : " Some uploads failed."
        : "";

      setStatus(errors.length ? "error" : "queued");
      setMessage(`${queuedMessage}${errorSuffix}`);
      setJobIds(queuedJobs.map((job) => job.jobId));
      onQueued?.(queuedJobs);
      if (errors.length > 0) {
        onError?.(errors[0]);
      }
      form.reset();
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "Something went wrong.";
      setStatus("error");
      setMessage(messageText);
      onError?.(messageText);
    }
  };

  const showModeSelector = modeSelectorVisible;
  const showExistingSelector =
    existingSessionSelectorVisible && sessionMode === "existing";

  return (
    <form className={`form-grid ${className}`.trim()} onSubmit={handleSubmit}>
      {showModeSelector || showExistingSelector ? (
        <div className="session-row">
          {showModeSelector ? (
            <div>
              <label>Session</label>
              <div className="session-mode-group" role="group" aria-label="Session mode">
                <button
                  type="button"
                  className={`button-secondary session-mode-option${
                    sessionMode === "auto" ? " active" : ""
                  }`}
                  aria-pressed={sessionMode === "auto"}
                  onClick={() => onSessionModeChange?.("auto")}
                >
                  Auto Session
                </button>
                <button
                  type="button"
                  className={`button-secondary session-mode-option${
                    sessionMode === "new" ? " active" : ""
                  }`}
                  aria-pressed={sessionMode === "new"}
                  onClick={() => onSessionModeChange?.("new")}
                >
                  New Session
                </button>
                <button
                  type="button"
                  className={`button-secondary session-mode-option${
                    sessionMode === "existing" ? " active" : ""
                  }`}
                  aria-pressed={sessionMode === "existing"}
                  onClick={() => onSessionModeChange?.("existing")}
                  disabled={!canChooseExisting}
                >
                  Existing Session
                </button>
              </div>
              {!isSessionsLoading && sessions.length === 0 ? (
                <p className="helper session-mode-helper">No existing sessions yet.</p>
              ) : null}
              {sessionMode === "auto" ? (
                <p className="helper session-mode-helper">
                  We&apos;ll group these images into sessions based on photo timestamps.
                </p>
              ) : null}
            </div>
          ) : null}
          {showExistingSelector ? (
            <div>
              <label htmlFor="existingSessionSelect">Choose existing session</label>
              <select
                id="existingSessionSelect"
                value={selectedExistingSessionId ?? ""}
                onChange={(event) =>
                  onExistingSessionChange?.(event.target.value || null)
                }
              >
                {isSessionsLoading ? (
                  <option value="">Loading sessions...</option>
                ) : sessions.length === 0 ? (
                  <option value="">No existing sessions</option>
                ) : (
                  <>
                    <option value="">Choose a session</option>
                    {sessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.label}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}
      <div>
        <label htmlFor="playerName">{nameLabel}</label>
        <input
          id="playerName"
          name="playerName"
          type="text"
          placeholder={namePlaceholder}
          required
        />
      </div>
      <div>
        <label htmlFor="image">{imageLabel}</label>
        <input
          id="image"
          name="image"
          type="file"
          accept="image/*"
          multiple
          required
        />
      </div>
      <div className="full">
        <button
          type="submit"
          disabled={
            status === "submitting" ||
            (sessionMode === "existing" &&
              (isSessionsLoading || !selectedExistingSessionId))
          }
        >
          <span className="button-content">
            {status === "submitting" ? (
              <span className="spinner" aria-hidden="true" />
            ) : null}
            {status === "submitting" ? "Adding..." : "Add to Log"}
          </span>
        </button>
        {submitHelperText ? (
          <p className="helper upload-submit-helper">{submitHelperText}</p>
        ) : null}
      </div>
      {status !== "idle" && message ? (
        <div className={`status ${status === "error" ? "error" : ""}`}>
          {message}
          {isDebug && jobIds.length > 0 ? ` Job IDs: ${jobIds.join(", ")}.` : ""}
        </div>
      ) : null}
    </form>
  );
}
