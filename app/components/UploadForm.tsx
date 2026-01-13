"use client";

import { useState } from "react";
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

type UploadFormProps = {
  onQueued?: (jobId: string, message: string) => void;
  onError?: (message: string) => void;
};

export default function UploadForm({ onQueued, onError }: UploadFormProps) {
  const [status, setStatus] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("submitting");
    setMessage("");
    setJobId("");

    const form = event.currentTarget;
    const formData = new FormData(form);
    const playerName = formData.get("playerName");
    const image = formData.get("image");
    formData.set(
      "timezoneOffsetMinutes",
      String(new Date().getTimezoneOffset())
    );

    if (typeof playerName !== "string" || playerName.trim().length === 0) {
      const errorMessage = "Please enter the player name on the scoreboard.";
      setStatus("error");
      setMessage(errorMessage);
      onError?.(errorMessage);
      return;
    }

    if (!(image instanceof File) || image.size === 0) {
      const errorMessage = "Please select a scoreboard image to upload.";
      setStatus("error");
      setMessage(errorMessage);
      onError?.(errorMessage);
      return;
    }

    try {
      const response = await authFetch("/api/submit", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Submission failed.");
      }

      const payload = (await response.json()) as SubmitResponse;
      setStatus("queued");
      setMessage(payload.message);
      setJobId(payload.jobId);
      onQueued?.(payload.jobId, payload.message);
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
        <label htmlFor="playerName">Player name on the sheet</label>
        <input
          id="playerName"
          name="playerName"
          type="text"
          placeholder="Jordan, Alex, etc"
          required
        />
      </div>
      <div>
        <label htmlFor="image">Scoreboard image</label>
        <input id="image" name="image" type="file" accept="image/*" required />
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
          {jobId ? ` Job ID: ${jobId}.` : ""}
        </div>
      ) : null}
    </form>
  );
}
