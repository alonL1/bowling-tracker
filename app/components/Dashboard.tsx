"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import UploadForm from "./UploadForm";
import GameReview from "./GameReview";
import ChatPanel from "./ChatPanel";
import { authFetch } from "../lib/authClient";

type JobStatus = "queued" | "processing" | "logged" | "error";

type StatusResponse = {
  jobId: string;
  status: JobStatus;
  lastError?: string | null;
  updatedAt?: string;
  gameId?: string;
};

type GameDetail = {
  id: string;
  game_name?: string | null;
  player_name: string;
  total_score: number | null;
  played_at?: string | null;
  status: string;
  frames?: Array<{
    id: string;
    frame_number: number;
    is_strike: boolean;
    is_spare: boolean;
    shots?: Array<{
      id: string;
      shot_number: number;
      pins: number | null;
    }>;
  }>;
};

type GameListItem = {
  id: string;
  game_name?: string | null;
  player_name: string;
  total_score: number | null;
  status: string;
  played_at?: string | null;
  created_at: string;
};

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40;

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

function buildScoreRows(game: GameDetail) {
  const row1: string[] = [];
  const row2: string[] = [];
  const row3: string[] = [];
  let showRow3 = false;

  for (let frameNumber = 1; frameNumber <= 10; frameNumber += 1) {
    const frame = game.frames?.find((item) => item.frame_number === frameNumber);
    const shots = frame?.shots || [];
    const shot1 = shots.find((shot) => shot.shot_number === 1)?.pins ?? null;
    const shot2 = shots.find((shot) => shot.shot_number === 2)?.pins ?? null;
    const shot3 = shots.find((shot) => shot.shot_number === 3)?.pins ?? null;

    if (frameNumber < 10) {
      if (shot1 === 10) {
        row1.push("X");
        row2.push("");
      } else {
        row1.push(toSymbol(shot1));
        if (shot1 !== null && shot2 !== null && shot1 + shot2 === 10) {
          row2.push("/");
        } else {
          row2.push(toSymbol(shot2));
        }
      }
      row3.push("");
    } else {
      row1.push(shot1 === 10 ? "X" : toSymbol(shot1));
      if (shot1 !== null && shot1 !== 10 && shot2 !== null && shot1 + shot2 === 10) {
        row2.push("/");
      } else {
        row2.push(shot2 === 10 ? "X" : toSymbol(shot2));
      }
      if (shot3 !== null && shot3 !== undefined) {
        showRow3 = true;
      }
      row3.push(shot3 === 10 ? "X" : toSymbol(shot3));
    }
  }

  return { row1, row2, row3, showRow3 };
}

export default function Dashboard() {
  const [jobId, setJobId] = useState<string>("");
  const [jobStatus, setJobStatus] = useState<JobStatus | "">("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [jobError, setJobError] = useState<string>("");
  const [gameError, setGameError] = useState<string>("");
  const [games, setGames] = useState<GameListItem[]>([]);
  const [gamesTotal, setGamesTotal] = useState<number | null>(null);
  const [gamesLimit, setGamesLimit] = useState<number>(10);
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [expandedGames, setExpandedGames] = useState<Record<string, GameDetail>>(
    {}
  );
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editingMode, setEditingMode] = useState<"review" | "edit">("edit");
  const [chatGameId, setChatGameId] = useState<string | null>(null);
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null);
  const pollCountRef = useRef(0);

  const loadGames = useCallback(async () => {
    try {
<<<<<<< HEAD
      const response = await fetch(`/api/games?limit=${gamesLimit}`);
=======
      const response = await authFetch(`/api/games?limit=${gamesLimit}`);
>>>>>>> test-preview-mode
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to load games list.");
      }
      const payload = (await response.json()) as {
        games: GameListItem[];
        count?: number | null;
      };
      const nextGames = payload.games || [];
      setGames(nextGames);
      setGamesTotal(
        typeof payload.count === "number" ? payload.count : null
      );
      if (!chatGameId && nextGames.length > 0) {
        setChatGameId(nextGames[0].id);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load games list.";
      setGameError(message);
      setGamesTotal(null);
    }
  }, [chatGameId, gamesLimit]);

  const loadGame = useCallback(async (lookup: string) => {
    setGameError("");
    try {
      const response = await authFetch(`/api/game?gameId=${lookup}`);
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to load game.");
      }
      const payload = (await response.json()) as { game: GameDetail };
      setExpandedGames((current) => ({ ...current, [lookup]: payload.game }));
      return payload.game;
    } catch (error) {
      setGameError(
        error instanceof Error ? error.message : "Failed to load game."
      );
      return null;
    }
  }, []);

  const loadGameFromJob = useCallback(async (lookupJobId: string) => {
    setGameError("");
    try {
      const response = await authFetch(`/api/game?jobId=${lookupJobId}`);
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to load game.");
      }
      const payload = (await response.json()) as { game: GameDetail };
      setExpandedGames((current) => ({
        ...current,
        [payload.game.id]: payload.game
      }));
      setExpandedGameId(payload.game.id);
      setEditingGameId(payload.game.id);
      setEditingMode("review");
      setChatGameId(payload.game.id);
    } catch (error) {
      setGameError(
        error instanceof Error ? error.message : "Failed to load game."
      );
    }
  }, []);

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let isActive = true;
    pollCountRef.current = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const checkStatus = async () => {
      if (!isActive) {
        return;
      }

      pollCountRef.current += 1;

      try {
        const response = await authFetch(`/api/status?jobId=${jobId}`);

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error || "Status check failed.");
        }

        const payload = (await response.json()) as StatusResponse;
        setJobStatus(payload.status);

        if (payload.status === "queued") {
          setStatusMessage("Queued. Waiting for the worker to pick it up.");
        } else if (payload.status === "processing") {
          setStatusMessage("Processing with Gemini...");
        } else if (payload.status === "logged") {
          setStatusMessage("Extraction complete. Logged.");
          await loadGameFromJob(jobId);
          await loadGames();
        } else if (payload.status === "error") {
          setJobError(
            payload.lastError
              ? `Job failed: ${payload.lastError}`
              : "Job failed during processing."
          );
        }

        if (payload.status === "logged" || payload.status === "error") {
          if (intervalId) {
            clearInterval(intervalId);
          }
        }
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "Status check failed.";
        setJobError(messageText);
        if (intervalId) {
          clearInterval(intervalId);
        }
      }

      if (pollCountRef.current >= MAX_POLLS) {
        setStatusMessage("Still queued. Refresh later to check again.");
        if (intervalId) {
          clearInterval(intervalId);
        }
      }
    };

    checkStatus();
    intervalId = setInterval(checkStatus, POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [jobId, loadGameFromJob, loadGames]);

  const handleQueued = (newJobId: string, message: string) => {
    setJobId(newJobId);
    setJobStatus("queued");
    setStatusMessage(message);
    setJobError("");
    setEditingGameId(null);
    setEditingMode("edit");
  };

  const handleConfirm = async (gameId: string) => {
    setEditingGameId(null);
    setEditingMode("edit");
    setExpandedGameId(null);
    await loadGame(gameId);
    await loadGames();
  };

  const handleCancelEdit = () => {
    setEditingGameId(null);
    setEditingMode("edit");
    setExpandedGameId(null);
  };

  const handleDelete = async (gameId: string) => {
    if (deletingGameId) {
      return;
    }
    const confirmed = window.confirm(
      "Delete this game and all of its frames? This cannot be undone."
    );
    if (!confirmed) {
      return;
    }
    setDeletingGameId(gameId);
    setGameError("");
    try {
      const response = await authFetch("/api/game", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to delete game.");
      }

      setExpandedGames((current) => {
        const next = { ...current };
        delete next[gameId];
        return next;
      });
      if (expandedGameId === gameId) {
        setExpandedGameId(null);
      }
      if (editingGameId === gameId) {
        setEditingGameId(null);
        setEditingMode("edit");
      }
      await loadGames();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete game.";
      setGameError(message);
    } finally {
      setDeletingGameId(null);
    }
  };

  const handleEdit = async (gameId: string) => {
    setExpandedGameId(gameId);
    const detail = expandedGames[gameId] ?? (await loadGame(gameId));
    if (detail) {
      setEditingGameId(gameId);
      setEditingMode("edit");
    }
  };

  const toggleExpand = async (gameId: string) => {
    const nextId = expandedGameId === gameId ? null : gameId;
    setExpandedGameId(nextId);
    if (nextId && !expandedGames[nextId]) {
      await loadGame(nextId);
    }
    if (nextId !== gameId || nextId === null) {
      setEditingGameId(null);
      setEditingMode("edit");
    }
  };

  const activeGameLabel = "all games";
  const showLoadMore = gamesTotal !== null && games.length < gamesTotal;
  const handleLoadMore = () => {
    setGamesLimit((prev) => prev + 10);
  };

  return (
    <div className="dashboard">
      <section className="panel anchor-section" id="submit">
        <div className="panel-header">
          <h2>Log a game</h2>
          <p className="helper">
            Upload a scoreboard image, then wait for the worker to finish.
          </p>
        </div>
        <UploadForm onQueued={handleQueued} onError={setJobError} />
        {statusMessage ? (
          <div className="status">
            <span className="status-content">
              {jobStatus === "queued" || jobStatus === "processing" ? (
                <span className="spinner spinner-muted" aria-hidden="true" />
              ) : null}
              <span>
                {statusMessage}
                {jobStatus ? ` Status: ${jobStatus}.` : ""}
              </span>
            </span>
          </div>
        ) : null}
        {jobError ? <p className="helper error-text">{jobError}</p> : null}
      </section>

      <section className="panel anchor-section" id="games">
        <div className="panel-header">
          <h2>Your games</h2>
          <p className="helper">
            Expand a game to view the frames in a compact score format.
          </p>
          <p className="helper">
            {gamesTotal !== null
              ? `Showing last ${games.length} of ${gamesTotal} games.`
              : `Showing ${games.length} games.`}
          </p>
        </div>
        <div className="games-list">
          {games.length === 0 ? (
            <p className="helper">No games yet.</p>
          ) : (
            games.map((game, index) => {
              const expanded = expandedGameId === game.id;
              const detail = expandedGames[game.id];
              const rows = detail ? buildScoreRows(detail) : null;
              const gameNumber = games.length - index;
              const gameTitle =
                game.game_name && game.game_name.trim().length > 0
                  ? game.game_name
                  : `Game ${gameNumber}`;

              return (
                <div key={game.id} className="game-card">
                  <div className="game-row">
                    <div className="game-meta">
                      <p className="game-title">{gameTitle}</p>
                      <p className="helper">
                        {game.player_name ? `${game.player_name} · ` : ""}
                        {new Date(game.played_at || game.created_at).toLocaleString()}
                        {game.total_score !== null
                          ? ` · Score: ${game.total_score}`
                          : ""}
                      </p>
                    </div>
                    <div className="game-actions-inline">
                      <button
                        type="button"
                        className="edit-toggle"
                        onClick={() => handleEdit(game.id)}
                        aria-label={`Edit ${gameTitle}`}
                        title={`Edit ${gameTitle}`}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                        >
                          <path
                            d="M4 20h4l11-11-4-4L4 16v4z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M13 7l4 4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="delete-toggle"
                        onClick={() => handleDelete(game.id)}
                        disabled={deletingGameId === game.id}
                        aria-label={`Delete ${gameTitle}`}
                        title={`Delete ${gameTitle}`}
                      >
                        {deletingGameId === game.id ? (
                          <span className="spinner" aria-hidden="true" />
                        ) : (
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                          >
                            <path
                              d="M6 7h12l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7zm3-4h6l1 2h4v2H4V5h4l1-2zm2 7v8m4-8v8"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        className="expand-toggle"
                        onClick={() => toggleExpand(game.id)}
                        aria-expanded={expanded}
                        aria-controls={`game-score-${game.id}`}
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${gameTitle}`}
                        title={`${expanded ? "Collapse" : "Expand"} ${gameTitle}`}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                        >
                          <path
                            d="M9 6l6 6-6 6"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {expanded ? (
                    <div className="game-score" id={`game-score-${game.id}`}>
                      {detail && rows ? (
                        editingGameId === game.id ? (
                          <GameReview
                            game={detail}
                            mode={editingMode}
                            onConfirmed={() => handleConfirm(game.id)}
                            onCancel={handleCancelEdit}
                          />
                        ) : (
                          <div className="score-grid">
                            <div className="score-row score-header">
                              {Array.from({ length: 10 }, (_, index) => (
                                <div key={`h-${game.id}-${index}`} className="score-cell">
                                  {index + 1}
                                </div>
                              ))}
                            </div>
                            <div className="score-row">
                              {rows.row1.map((cell, index) => (
                                <div key={`r1-${game.id}-${index}`} className="score-cell">
                                  {cell}
                                </div>
                              ))}
                            </div>
                            <div className="score-row">
                              {rows.row2.map((cell, index) => (
                                <div key={`r2-${game.id}-${index}`} className="score-cell">
                                  {cell}
                                </div>
                              ))}
                            </div>
                            {rows.showRow3 ? (
                              <div className="score-row">
                                {rows.row3.map((cell, index) => (
                                  <div key={`r3-${game.id}-${index}`} className="score-cell">
                                    {cell}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )
                      ) : (
                        <div className="loading-row">
                          <span className="spinner spinner-muted" aria-hidden="true" />
                          <span className="helper">Loading frames...</span>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
        {showLoadMore ? (
          <div className="games-footer">
            <button
              type="button"
              className="button-secondary load-more-button"
              onClick={handleLoadMore}
            >
              Load more
            </button>
          </div>
        ) : null}
        {gameError ? <p className="helper error-text">{gameError}</p> : null}
      </section>

      <section className="panel anchor-section" id="chat">
        <ChatPanel gameLabel={activeGameLabel} />
      </section>
    </div>
  );
}
