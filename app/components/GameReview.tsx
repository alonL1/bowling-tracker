"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

type Shot = {
  id?: string;
  shot_number: number;
  pins: number | null;
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
  frames?: Frame[];
};

type GameReviewProps = {
  game: Game;
  mode?: "review" | "edit";
  onConfirmed?: () => void;
  onCancel?: () => void;
};

type FrameDraft = {
  id: string | null;
  frame_number: number;
  shots: Shot[];
};

type ActiveCell = {
  frameIndex: number;
  shotNumber: number;
};

function normalizeFrames(frames: Frame[]) {
  const frameMap = new Map<number, Frame>();
  frames.forEach((frame) => {
    frameMap.set(frame.frame_number, frame);
  });

  return Array.from({ length: 10 }, (_, index) => {
    const frameNumber = index + 1;
    const frame = frameMap.get(frameNumber);
    const shots = [1, 2, 3].map((shotNumber) => {
      const existing = frame?.shots?.find(
        (shot) => shot.shot_number === shotNumber
      );
      return {
        id: existing?.id,
        shot_number: shotNumber,
        pins: existing?.pins ?? null
      };
    });
    return {
      id: frame?.id ?? null,
      frame_number: frameNumber,
      shots
    };
  });
}

function toSymbol(pins: number | null) {
  if (pins === null || pins === undefined) {
    return "";
  }
  if (pins === 10) {
    return "X";
  }
  if (pins === 0) {
    return "-";
  }
  return String(pins);
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
  const [playedAt, setPlayedAt] = useState<string>(
    toLocalInputValue(game.played_at)
  );
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveMessage, setSaveMessage] = useState<string>("");

  useEffect(() => {
    setFrames(initialFrames);
    setPlayedAt(toLocalInputValue(game.played_at));
    setSaveStatus("idle");
    setSaveMessage("");
    setActiveCell(null);
    setHasChanges(false);
  }, [game.id, game.total_score, game.played_at, initialFrames]);

  useEffect(() => {
    const initialPlayedAt = toLocalInputValue(game.played_at);
    const playedAtChanged = playedAt !== initialPlayedAt;
    const framesChanged =
      JSON.stringify(frames) !== JSON.stringify(initialFrames);
    const totalMissing = game.total_score === null;
    setHasChanges(playedAtChanged || framesChanged || totalMissing);
  }, [frames, playedAt, initialFrames, game.played_at]);

  const showCancel = !!onCancel;

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

  const handleCellChange = (frameIndex: number, shotNumber: number, value: string) => {
    handleShotChange(frameIndex, shotNumber - 1, value);
  };

  const getShotValue = (frame: FrameDraft, shotNumber: number) => {
    return frame.shots[shotNumber - 1]?.pins ?? null;
  };

  const isEditableCell = (frame: FrameDraft, shotNumber: number) => {
    if (shotNumber === 3) {
      return frame.frame_number === 10;
    }
    if (shotNumber === 2 && frame.frame_number < 10) {
      const shot1 = getShotValue(frame, 1);
      return shot1 !== 10;
    }
    return true;
  };

  const getDisplayValue = (frame: FrameDraft, shotNumber: number) => {
    const shot1 = getShotValue(frame, 1);
    const shot2 = getShotValue(frame, 2);
    const shot3 = getShotValue(frame, 3);

    if (shotNumber === 1) {
      return toSymbol(shot1);
    }

    if (shotNumber === 2) {
      if (frame.frame_number < 10) {
        if (shot1 === 10) {
          return "";
        }
        if (shot1 !== null && shot2 !== null && shot1 + shot2 === 10) {
          return "/";
        }
        return toSymbol(shot2);
      }
      if (shot1 !== null && shot1 !== 10 && shot2 !== null && shot1 + shot2 === 10) {
        return "/";
      }
      return toSymbol(shot2 === 10 ? 10 : shot2);
    }

    if (shotNumber === 3) {
      return toSymbol(shot3);
    }

    return "";
  };

  const handleCellKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      setActiveCell(null);
    }
  };
  const handleConfirm = async () => {
    setSaveStatus("saving");
    setSaveMessage("");

    const parsedPlayedAt = playedAt ? new Date(playedAt) : null;

    const payload = {
      gameId: game.id,
      playedAt:
        parsedPlayedAt && !Number.isNaN(parsedPlayedAt.getTime())
          ? parsedPlayedAt.toISOString()
          : null,
      frames: frames.map((frame) => ({
        frameId: frame.id ?? null,
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
      setSaveMessage("Saved. Status updated to logged.");
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
        <p className="helper">Player: {game.player_name}</p>
        <div className="review-meta">
          <div className="total-row">
            <label>Total score</label>
            <div>
              <p className="helper">
                {game.total_score !== null ? game.total_score : "n/a"}
              </p>
              {game.total_score === null ? (
                <p className="helper">
                  Couldn&apos;t find total score. Clicking confirm will
                  calculate it.
                </p>
              ) : null}
            </div>
          </div>
          <div className="total-row">
            <label htmlFor={`playedAt-${game.id}`}>Played at</label>
            <input
              id={`playedAt-${game.id}`}
              type="datetime-local"
              value={playedAt}
              onChange={(event) => setPlayedAt(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="score-grid edit-score-grid">
        <div className="score-row score-header">
          {frames.map((frame) => {
            const frameKey = frame.id ?? `frame-${frame.frame_number}`;
            return (
            <div key={`h-${frameKey}`} className="score-cell">
              {frame.frame_number}
            </div>
            );
          })}
        </div>
        {[1, 2, 3].map((shotNumber) => (
          <div key={`row-${shotNumber}`} className="score-row">
            {frames.map((frame, frameIndex) => {
              const frameKey = frame.id ?? `frame-${frame.frame_number}`;
              const isEditable = isEditableCell(frame, shotNumber);
              const isActive =
                activeCell?.frameIndex === frameIndex &&
                activeCell?.shotNumber === shotNumber;
              const display = getDisplayValue(frame, shotNumber);

              if (!isEditable) {
                return (
                  <div
                    key={`c-${frameKey}-${shotNumber}`}
                    className="score-cell score-cell-empty"
                    aria-hidden="true"
                  />
                );
              }

              if (isActive) {
                return (
                  <input
                    key={`i-${frameKey}-${shotNumber}`}
                    type="number"
                    min={0}
                    max={10}
                    className="score-cell-input"
                    value={getShotValue(frame, shotNumber) ?? ""}
                    onChange={(event) =>
                      handleCellChange(frameIndex, shotNumber, event.target.value)
                    }
                    onBlur={() => setActiveCell(null)}
                    onKeyDown={handleCellKeyDown}
                    autoFocus
                  />
                );
              }

              return (
                <button
                  key={`b-${frameKey}-${shotNumber}`}
                  type="button"
                  className="score-cell score-cell-button"
                  onClick={() => setActiveCell({ frameIndex, shotNumber })}
                  aria-label={`Frame ${frame.frame_number} shot ${shotNumber}`}
                >
                  {display}
                </button>
              );
            })}
          </div>
        ))}
      </div>

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
        {hasChanges ? (
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
        ) : null}
        {saveMessage ? (
          <p className={`helper ${saveStatus === "error" ? "error-text" : ""}`}>
            {saveMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
