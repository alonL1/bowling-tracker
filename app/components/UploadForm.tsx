"use client";

import { useEffect, useState } from "react";
import { authFetch, getAccessToken, supabase } from "../lib/authClient";

type SubmitState = "idle" | "submitting" | "queued" | "error";

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
  selectedSessionId?: string | null;
  onSessionChange?: (sessionId: string | null) => void;
  onCreateSession?: () => Promise<string | null>;
};

export default function UploadForm({
  onQueued,
  onError,
  pendingJobsCount = 0,
  sessions = [],
  selectedSessionId = null,
  onSessionChange,
  onCreateSession
}: UploadFormProps) {
  const [status, setStatus] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string>("");
  const [jobIds, setJobIds] = useState<string[]>([]);
  const isDebug = process.env.CHAT_DEBUG === "true";
  const bucket =
    process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || "scoreboards-temp";

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
    const sessionId = selectedSessionId;

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

    if (!sessionId) {
      const errorMessage = "Please select a session before logging games.";
      setStatus("error");
      setMessage(errorMessage);
      onError?.(errorMessage);
      return;
    }

    let resolvedSessionId = sessionId;
    if (sessionId === "new") {
      if (!onCreateSession) {
        const errorMessage = "Unable to create a new session right now.";
        setStatus("error");
        setMessage(errorMessage);
        onError?.(errorMessage);
        return;
      }
      const createdId = await onCreateSession();
      if (!createdId) {
        const errorMessage = "Failed to create a new session.";
        setStatus("error");
        setMessage(errorMessage);
        onError?.(errorMessage);
        return;
      }
      resolvedSessionId = createdId;
    }

    try {
      if (!supabase) {
        throw new Error("Supabase client not configured.");
      }
      await getAccessToken();

      const normalizedNames = nameList.join(", ");
      const uploadErrors: string[] = [];
      const storageKeys: string[] = [];

      for (const image of images) {
        const extension = getExtension(image);
        const storageKey = `${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storageKey, image, {
            contentType: image.type || "image/jpeg",
            upsert: false
          });
        if (uploadError) {
          uploadErrors.push(uploadError.message || "Failed to upload image.");
          continue;
        }
        storageKeys.push(storageKey);
      }

      if (storageKeys.length === 0) {
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
          sessionId: resolvedSessionId,
          storageKeys
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

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <div className="session-row">
        <div>
          <label htmlFor="sessionSelect">Session</label>
          <select
            id="sessionSelect"
            value={selectedSessionId ?? ""}
            onChange={(event) =>
              onSessionChange?.(event.target.value || null)
            }
          >
            {sessions.length === 0 ? (
              <option value="new">New session</option>
            ) : (
              <>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.label}
                  </option>
                ))}
                <option value="new">New session</option>
              </>
            )}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="playerName">Your name(s) on the sheet</label>
        <input
          id="playerName"
          name="playerName"
          type="text"
          placeholder="Alexander, Alex, Xander"
          required
        />
      </div>
      <div>
        <label htmlFor="image">Scoreboard image(s)</label>
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
          disabled={status === "submitting" || !selectedSessionId}
        >
          <span className="button-content">
            {status === "submitting" ? (
              <span className="spinner" aria-hidden="true" />
            ) : null}
            {status === "submitting" ? "Adding..." : "Add to Log"}
          </span>
        </button>
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
