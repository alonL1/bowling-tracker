"use client";

import { useEffect, useState } from "react";
import { authFetch } from "../lib/authClient";

type SubmitState = "idle" | "submitting" | "queued" | "error";

type SubmitResponse = {
  jobId: string;
  message: string;
  metadata?: {
    playerName: string;
    size: number;
    type: string;
  };
};

type QueuedJob = {
  jobId: string;
  message: string;
};

type UploadFormProps = {
  onQueued?: (jobs: QueuedJob[]) => void;
  onError?: (message: string) => void;
  pendingJobsCount?: number;
};

export default function UploadForm({
  onQueued,
  onError,
  pendingJobsCount = 0
}: UploadFormProps) {
  const [status, setStatus] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string>("");
  const [jobIds, setJobIds] = useState<string[]>([]);
  const isDebug = process.env.CHAT_DEBUG === "true";

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

    try {
      const queuedJobs: QueuedJob[] = [];
      const errors: string[] = [];
      const normalizedNames = nameList.join(", ");

      for (const image of images) {
        const requestData = new FormData();
        requestData.append("playerName", normalizedNames);
        requestData.append("timezoneOffsetMinutes", timezoneOffsetMinutes);
        requestData.append("image", image);

        try {
          const response = await authFetch("/api/submit", {
            method: "POST",
            body: requestData
          });

          if (!response.ok) {
            const payload = (await response.json()) as { error?: string };
            throw new Error(payload.error || "Submission failed.");
          }

          const payload = (await response.json()) as SubmitResponse;
          queuedJobs.push({ jobId: payload.jobId, message: payload.message });
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : "Submission failed.";
          errors.push(messageText);
        }
      }

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
        <button type="submit" disabled={status === "submitting"}>
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
