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

type PendingJob = {
  jobId: string;
  status: JobStatus;
  message: string;
  lastError?: string;
  isStale?: boolean;
};

type GameDetail = {
  id: string;
  game_name?: string | null;
  player_name: string;
  total_score: number | null;
  played_at?: string | null;
  created_at?: string | null;
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
  const [pendingJobs, setPendingJobs] = useState<PendingJob[]>([]);
  const [gameError, setGameError] = useState<string>("");
  const [games, setGames] = useState<GameListItem[]>([]);
  const [gamesTotal, setGamesTotal] = useState<number | null>(null);
  const [gamesLimit, setGamesLimit] = useState<number>(20);
  const [loggedPopupGames, setLoggedPopupGames] = useState<GameListItem[]>([]);
  const [showLoggedPopup, setShowLoggedPopup] = useState<boolean>(false);
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [expandedGames, setExpandedGames] = useState<Record<string, GameDetail>>(
    {}
  );
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editingMode, setEditingMode] = useState<"review" | "edit">("edit");
  const [chatGameId, setChatGameId] = useState<string | null>(null);
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null);
  const pendingJobsRef = useRef<PendingJob[]>([]);
  const pollCountsRef = useRef<Record<string, number>>({});

  const loadGames = useCallback(async () => {
    try {
      const response = await authFetch(`/api/games?limit=${gamesLimit}`);
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

  const toGameListItem = useCallback(
    (game: GameDetail): GameListItem => ({
      id: game.id,
      game_name: game.game_name ?? null,
      player_name: game.player_name,
      total_score: game.total_score ?? null,
      status: game.status,
      played_at: game.played_at ?? null,
      created_at: game.created_at ?? new Date().toISOString()
    }),
    []
  );

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
      return payload.game;
    } catch (error) {
      setGameError(
        error instanceof Error ? error.message : "Failed to load game."
      );
      return null;
    }
  }, []);

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  useEffect(() => {
    pendingJobsRef.current = pendingJobs;
  }, [pendingJobs]);

  useEffect(() => {
    const hasActiveJobs = pendingJobs.some(
      (job) =>
        !job.isStale &&
        (job.status === "queued" || job.status === "processing")
    );
    if (!hasActiveJobs) {
      return;
    }

    let isActive = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const updateJob = (jobId: string, updates: Partial<PendingJob>) => {
      setPendingJobs((current) =>
        current.map((job) =>
          job.jobId === jobId ? { ...job, ...updates } : job
        )
      );
    };

    const checkStatus = async () => {
      if (!isActive) {
        return;
      }

      const jobs = pendingJobsRef.current;
      for (const job of jobs) {
        if (
          job.isStale ||
          job.status === "logged" ||
          job.status === "error"
        ) {
          continue;
        }

        pollCountsRef.current[job.jobId] =
          (pollCountsRef.current[job.jobId] ?? 0) + 1;

        try {
          const response = await authFetch(`/api/status?jobId=${job.jobId}`);

          if (!response.ok) {
            const payload = (await response.json()) as { error?: string };
            throw new Error(payload.error || "Status check failed.");
          }

          const payload = (await response.json()) as StatusResponse;
          let nextMessage = job.message;

          if (payload.status === "queued") {
            nextMessage = "Queued. Waiting for the worker to pick it up.";
          } else if (payload.status === "processing") {
            nextMessage = "Processing with Gemini...";
          } else if (payload.status === "logged") {
            nextMessage = "Extraction complete. Logged.";
            const loggedGame = await loadGameFromJob(job.jobId);
            if (loggedGame) {
              const listItem = toGameListItem(loggedGame);
              setLoggedPopupGames((current) => {
                if (current.some((item) => item.id === listItem.id)) {
                  return current;
                }
                return [listItem, ...current];
              });
              setShowLoggedPopup(true);
            }
            await loadGames();
          } else if (payload.status === "error") {
            nextMessage = payload.lastError
              ? `Job failed: ${payload.lastError}`
              : "Job failed during processing.";
          }

          updateJob(job.jobId, {
            status: payload.status,
            message: nextMessage,
            lastError: payload.lastError ?? undefined
          });
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : "Status check failed.";
          updateJob(job.jobId, { status: "error", message: messageText });
        }

        if (pollCountsRef.current[job.jobId] >= MAX_POLLS) {
          updateJob(job.jobId, {
            isStale: true,
            message: "Still queued. Refresh later to check again."
          });
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
  }, [pendingJobs, loadGameFromJob, loadGames, toGameListItem]);

  const handleQueued = (jobs: Array<{ jobId: string; message: string }>) => {
    setPendingJobs((current) => {
      const existingIds = new Set(current.map((job) => job.jobId));
      const nextJobs = jobs
        .filter((job) => !existingIds.has(job.jobId))
        .map((job) => ({
          jobId: job.jobId,
          status: "queued" as JobStatus,
          message: job.message
        }));
      return [...current, ...nextJobs];
    });
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
      setLoggedPopupGames((current) =>
        current.filter((game) => game.id !== gameId)
      );
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
    setGamesLimit((prev) => prev + 20);
  };
  const popupGames = loggedPopupGames.map(
    (logged) => games.find((game) => game.id === logged.id) || logged
  );
  const popupIds = new Set(popupGames.map((game) => game.id));
  const displayGames = showLoggedPopup
    ? games.filter((game) => !popupIds.has(game.id))
    : games;
  const displayCount = games.length;
  const handleCloseLoggedPopup = () => {
    setShowLoggedPopup(false);
    setLoggedPopupGames([]);
  };
  const getGameNumber = (gameId: string) => {
    const index = games.findIndex((game) => game.id === gameId);
    if (index === -1) {
      return null;
    }
    const total = gamesTotal ?? games.length;
    return total - index;
  };
  const renderGameCard = (game: GameListItem) => {
    const expanded = expandedGameId === game.id;
    const detail = expandedGames[game.id];
    const rows = detail ? buildScoreRows(detail) : null;
    const gameNumber = getGameNumber(game.id);
    const trimmedName = game.game_name?.trim();
    const gameTitle = trimmedName
      ? trimmedName
      : gameNumber
        ? `Game ${gameNumber}`
        : "Game";

    return (
      <div key={game.id} className="game-card">
        <div className="game-row">
          <div className="game-meta">
            <p className="game-title">{gameTitle}</p>
            <p className="helper">
              {game.player_name ? `${game.player_name} - ` : ""}
              {new Date(game.played_at || game.created_at).toLocaleString()}
              {game.total_score !== null
                ? ` - Score: ${game.total_score}`
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
  };

  return (
    <div className="dashboard">
      <section className="panel anchor-section" id="submit">
        <div className="panel-header">
          <h2>Log a game</h2>
          <p className="helper">
            Upload a scoreboard image, then wait for the worker to finish. <br />
            To add multiple games at once simply select multiple images. <br />
            If have different names throughout the scoresheets, write them out comma seperated
          </p>
        </div>
        <UploadForm onQueued={handleQueued} />
        {pendingJobs.length > 0 ? (
          <div className="status-stack">
            {pendingJobs.map((job) => (
              <div
                key={job.jobId}
                className={`status ${job.status === "error" ? "error" : ""}`}
              >
                <span className="status-content">
                  {job.status === "queued" || job.status === "processing" ? (
                    <span className="spinner spinner-muted" aria-hidden="true" />
                  ) : null}
                  <span>
                    {job.message} Status: {job.status}. Job ID: {job.jobId}.
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel anchor-section" id="games">
        <div className="panel-header">
          <h2>Your games</h2>
          <p className="helper">
            Expand a game to view the frames.
          </p>
          <p className="helper">
            {gamesTotal !== null
              ? `Showing ${displayCount} of ${gamesTotal} games.`
              : `Showing ${displayCount} games.`}
          </p>
        </div>
        {showLoggedPopup && popupGames.length > 0 ? (
          <div className="logged-popup">
            <div className="logged-popup-header">
              <div>
                <h3>Newly logged games</h3>
                <p className="helper">
                  Review games for accuracy, then feel free to close this pop up.
                </p>
              </div>
              <button
                type="button"
                className="button-secondary logged-popup-close"
                onClick={handleCloseLoggedPopup}
              >
                Close
              </button>
            </div>
            <div className="games-list">
              {popupGames.map((game) => renderGameCard(game))}
            </div>
          </div>
        ) : null}
        <div className="games-list">
          {displayGames.length === 0 ? (
            <p className="helper">
              {games.length === 0 ? "No games yet." : "No other games yet."}
            </p>
          ) : (
            displayGames.map((game) => renderGameCard(game))
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



