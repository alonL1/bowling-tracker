"use client";

import { useEffect, useMemo, useState } from "react";

type Shot = {
  id?: string;
  shot_number: number;
  pins: number | null;
  confidence?: number | null;
};

type Frame = {
  id: string;
  frame_number: number;
  is_strike: boolean;
  is_spare: boolean;
  shots?: Shot[];
};

type Game = {
  id: string;
  player_name: string;
  total_score: number | null;
  played_at?: string | null;
  status: string;
  extraction_confidence?: number | null;
  frames?: Frame[];
};

type GameReviewProps = {
  game: Game;
  mode?: "review" | "edit";
  onConfirmed?: () => void;
  onCancel?: () => void;
};

type FrameDraft = {
  id: string;
  frame_number: number;
  shots: Shot[];
};

function normalizeFrames(frames: Frame[]) {
  return frames
    .slice()
    .sort((a, b) => a.frame_number - b.frame_number)
    .map((frame) => {
      const shots = [1, 2, 3].map((shotNumber) => {
        const existing = frame.shots?.find(
          (shot) => shot.shot_number === shotNumber
        );
        return {
          id: existing?.id,
          shot_number: shotNumber,
          pins: existing?.pins ?? null,
          confidence: existing?.confidence ?? null
        };
      });
      return {
        id: frame.id,
        frame_number: frame.frame_number,
        shots
      };
    });
}

function toLocalInputValue(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - offset);
  return local.toISOString().slice(0, 16);
}

export default function GameReview({
  game,
  mode = "review",
  onConfirmed,
  onCancel
}: GameReviewProps) {
  const initialFrames = useMemo(
    () => normalizeFrames(game.frames || []),
    [game.frames]
  );
  const [frames, setFrames] = useState<FrameDraft[]>(initialFrames);
  const [totalScore, setTotalScore] = useState<string>(
    game.total_score?.toString() ?? ""
  );
  const [playedAt, setPlayedAt] = useState<string>(
    toLocalInputValue(game.played_at)
  );
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveMessage, setSaveMessage] = useState<string>("");

  useEffect(() => {
    setFrames(initialFrames);
    setTotalScore(game.total_score?.toString() ?? "");
    setPlayedAt(toLocalInputValue(game.played_at));
    setSaveStatus("idle");
    setSaveMessage("");
  }, [game.id, game.total_score, game.played_at, initialFrames]);

  const extractionConfidence =
    game.extraction_confidence !== null && game.extraction_confidence !== undefined
      ? `${Math.round(game.extraction_confidence * 100)}%`
      : "n/a";
  const showCancel = mode === "edit" && !!onCancel;

  const handleShotChange = (
    frameIndex: number,
    shotIndex: number,
    value: string
  ) => {
    setFrames((prev) => {
      const next = prev.map((frame) => ({ ...frame, shots: [...frame.shots] }));
      const pins = value === "" ? null : Number(value);
      next[frameIndex].shots[shotIndex] = {
        ...next[frameIndex].shots[shotIndex],
        pins
      };
      return next;
    });
  };

  const handleConfirm = async () => {
    setSaveStatus("saving");
    setSaveMessage("");

    const parsedTotalScore =
      totalScore === "" ? null : Number.parseInt(totalScore, 10);
    const parsedPlayedAt = playedAt ? new Date(playedAt) : null;

    const payload = {
      gameId: game.id,
      totalScore: Number.isNaN(parsedTotalScore) ? null : parsedTotalScore,
      playedAt:
        parsedPlayedAt && !Number.isNaN(parsedPlayedAt.getTime())
          ? parsedPlayedAt.toISOString()
          : null,
      frames: frames.map((frame) => ({
        frameId: frame.id,
        frameNumber: frame.frame_number,
        shots: frame.shots.map((shot) => ({
          id: shot.id,
          shotNumber: shot.shot_number,
          pins: shot.pins
        }))
      }))
    };

    try {
      const response = await fetch("/api/game", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorPayload = (await response.json()) as { error?: string };
        throw new Error(errorPayload.error || "Failed to confirm edits.");
      }

      setSaveStatus("saved");
      setSaveMessage("Confirmed. Status updated to reviewed.");
      if (onConfirmed) {
        onConfirmed();
      }
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(
        error instanceof Error ? error.message : "Failed to confirm edits."
      );
    }
  };

  return (
    <div className="review-grid">
      <div className="review-header">
        <div>
          <p className="helper">
            Player: {game.player_name} · Extraction confidence: {extractionConfidence}
          </p>
        </div>
        <div className="review-meta">
          <div className="total-row">
            <label htmlFor="totalScore">Total score</label>
            <input
              id="totalScore"
              type="number"
              min={0}
              max={300}
              value={totalScore}
              onChange={(event) => setTotalScore(event.target.value)}
            />
          </div>
          <div className="total-row">
            <label htmlFor="playedAt">Played at</label>
            <input
              id="playedAt"
              type="datetime-local"
              value={playedAt}
              onChange={(event) => setPlayedAt(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="frame-header">
        <div>Frame</div>
        <div>Shot 1</div>
        <div>Shot 2</div>
        <div>Shot 3</div>
      </div>
      {frames.map((frame, frameIndex) => (
        <div key={frame.id} className="frame-row">
          <div className="frame-number">{frame.frame_number}</div>
          {frame.shots.map((shot, shotIndex) => (
            <input
              key={`${frame.id}-${shot.shot_number}`}
              type="number"
              min={0}
              max={10}
              disabled={frame.frame_number < 10 && shot.shot_number === 3}
              value={shot.pins ?? ""}
              onChange={(event) =>
                handleShotChange(frameIndex, shotIndex, event.target.value)
              }
            />
          ))}
        </div>
      ))}

      <div className="review-actions">
        {showCancel ? (
          <button
            type="button"
            className="button-secondary"
            onClick={onCancel}
            disabled={saveStatus === "saving"}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={saveStatus === "saving"}
        >
          <span className="button-content">
            {saveStatus === "saving" ? (
              <span className="spinner" aria-hidden="true" />
            ) : null}
            {saveStatus === "saving" ? "Confirming..." : "Confirm"}
          </span>
        </button>
        {saveMessage ? (
          <p className={`helper ${saveStatus === "error" ? "error-text" : ""}`}>
            {saveMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
