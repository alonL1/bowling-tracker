"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
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
  session_id?: string | null;
  session?: {
    id: string;
    name?: string | null;
    description?: string | null;
    started_at?: string | null;
    created_at?: string | null;
  } | null;
};

type SessionItem = {
  id: string;
  name?: string | null;
  description?: string | null;
  started_at?: string | null;
  created_at?: string | null;
};

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40;

type DroppableRenderProps = {
  setNodeRef: (node: HTMLElement | null) => void;
  isOver: boolean;
};

function DroppableContainer({
  id,
  children
}: {
  id: string;
  children: (props: DroppableRenderProps) => JSX.Element;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <>{children({ setNodeRef, isOver })}</>;
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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState<boolean>(false);
  const [pendingBatch, setPendingBatch] = useState<{
    jobIds: string[];
    loggedGameIds: string[];
  } | null>(null);
  const [reviewGameIds, setReviewGameIds] = useState<string[]>([]);
  const [scrollTargetSessionId, setScrollTargetSessionId] = useState<
    string | null
  >(null);
  const [collapsedSessions, setCollapsedSessions] = useState<Record<string, boolean>>(
    {}
  );
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionEditName, setSessionEditName] = useState<string>("");
  const [sessionEditDescription, setSessionEditDescription] = useState<string>("");
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [expandedGames, setExpandedGames] = useState<Record<string, GameDetail>>(
    {}
  );
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editingMode, setEditingMode] = useState<"review" | "edit">("edit");
  const [chatGameId, setChatGameId] = useState<string | null>(null);
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null);
  const [activeDragGameId, setActiveDragGameId] = useState<string | null>(null);
  const [movingGameId, setMovingGameId] = useState<string | null>(null);
  const pendingJobsRef = useRef<PendingJob[]>([]);
  const pollCountsRef = useRef<Record<string, number>>({});
  const gameCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sessionHeaderRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollAttemptsRef = useRef<number>(0);
  const dismissTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );
  const isDebug = process.env.CHAT_DEBUG === "true";
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 }
    })
  );

  const loadGames = useCallback(async () => {
    try {
      const response = await authFetch(`/api/games`);
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
  }, [chatGameId]);

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
    if (!pendingBatch) {
      return;
    }
    if (pendingBatch.loggedGameIds.length !== pendingBatch.jobIds.length) {
      return;
    }
    setReviewGameIds(pendingBatch.loggedGameIds);
    setPendingBatch(null);
  }, [pendingBatch]);

  useEffect(() => {
    if (!scrollTargetSessionId) {
      return;
    }
    let cancelled = false;
    const attemptScroll = () => {
      if (cancelled) {
        return;
      }
      const node = sessionHeaderRefs.current[scrollTargetSessionId];
      if (node) {
        const offset = 100;
        const top =
          node.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: "smooth" });
        scrollAttemptsRef.current = 0;
        setScrollTargetSessionId(null);
        return;
      }
      if (scrollAttemptsRef.current >= 10) {
        scrollAttemptsRef.current = 0;
        setScrollTargetSessionId(null);
        return;
      }
      scrollAttemptsRef.current += 1;
      setTimeout(attemptScroll, 150);
    };
    attemptScroll();
    return () => {
      cancelled = true;
    };
  }, [scrollTargetSessionId]);

  useEffect(() => {
    const activeIds = new Set(pendingJobs.map((job) => job.jobId));
    Object.entries(dismissTimersRef.current).forEach(([jobId, timer]) => {
      if (!activeIds.has(jobId)) {
        clearTimeout(timer);
        delete dismissTimersRef.current[jobId];
      }
    });
  }, [pendingJobs]);

  useEffect(() => {
    return () => {
      Object.values(dismissTimersRef.current).forEach((timer) => {
        clearTimeout(timer);
      });
      dismissTimersRef.current = {};
    };
  }, []);

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

    const scheduleDismiss = (jobId: string, delayMs = 4000) => {
      if (dismissTimersRef.current[jobId]) {
        return;
      }
      dismissTimersRef.current[jobId] = setTimeout(() => {
        setPendingJobs((current) =>
          current.filter((job) => job.jobId !== jobId)
        );
        delete dismissTimersRef.current[jobId];
      }, delayMs);
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

        let nextStatus: JobStatus | null = null;
        try {
          const response = await authFetch(`/api/status?jobId=${job.jobId}`);

          if (!response.ok) {
            const payload = (await response.json()) as { error?: string };
            throw new Error(payload.error || "Status check failed.");
          }

          const payload = (await response.json()) as StatusResponse;
          nextStatus = payload.status;
          let nextMessage = job.message;

          if (payload.status === "queued") {
            nextMessage = "Queued. Waiting for the worker to pick it up.";
          } else if (payload.status === "processing") {
            nextMessage = "Processing with Gemini...";
          } else if (payload.status === "logged") {
            nextMessage = "Extraction complete. Logged.";
            const loggedId =
              payload.gameId || (await loadGameFromJob(job.jobId))?.id || null;
            await loadGames();
            if (loggedId) {
              setPendingBatch((current) => {
                if (!current || !current.jobIds.includes(job.jobId)) {
                  return current;
                }
                if (current.loggedGameIds.includes(loggedId)) {
                  return current;
                }
                return {
                  ...current,
                  loggedGameIds: [...current.loggedGameIds, loggedId]
                };
              });
            }
            scheduleDismiss(job.jobId);
          } else if (payload.status === "error") {
            nextMessage = payload.lastError
              ? `Job failed: ${payload.lastError}`
              : "Job failed during processing.";
          }

          updateJob(job.jobId, {
            status: payload.status,
            message: nextMessage,
            lastError: payload.lastError ?? undefined,
            isStale:
              payload.status === "queued" || payload.status === "processing"
                ? job.isStale
                : false
          });
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : "Status check failed.";
          nextStatus = "error";
          updateJob(job.jobId, {
            status: "error",
            message: messageText,
            isStale: false
          });
        }

        if (pollCountsRef.current[job.jobId] >= MAX_POLLS) {
          const statusForStale = nextStatus ?? job.status;
          if (statusForStale === "queued" || statusForStale === "processing") {
            updateJob(job.jobId, {
              isStale: true,
              message: "Still queued. Refresh later to check again."
            });
          }
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
  }, [pendingJobs, loadGameFromJob, loadGames]);

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
    if (jobs.length > 0) {
      setPendingBatch({
        jobIds: jobs.map((job) => job.jobId),
        loggedGameIds: []
      });
    }
    setEditingGameId(null);
    setEditingMode("edit");
  };

  const handleReviewRecentlyLogged = () => {
    if (reviewGameIds.length === 0) {
      return;
    }
    const sessionIds = new Set<string>();
    let firstSessionId: string | null = null;
    reviewGameIds.forEach((gameId) => {
      const match = games.find((game) => game.id === gameId);
      if (!match) {
        return;
      }
      if (!firstSessionId) {
        firstSessionId = match.session_id ?? "sessionless";
      }
      sessionIds.add(match.session_id ?? "sessionless");
    });

    if (sessionIds.size > 0) {
      setCollapsedSessions((current) => {
        const next = { ...current };
        sessionIds.forEach((sessionId) => {
          next[sessionId] = false;
        });
        return next;
      });
    }

    setReviewGameIds([]);
    if (firstSessionId) {
      setScrollTargetSessionId(firstSessionId);
    }
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
      setNewLoggedIds((current) => current.filter((id) => id !== gameId));
      setDismissedLoggedIds((current) =>
        current.filter((id) => id !== gameId)
      );
      setLoggedGameCache((current) => {
        const next = { ...current };
        delete next[gameId];
        return next;
      });
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
  const displayGames = games;
  const toggleSession = (sessionId: string) => {
    setCollapsedSessions((current) => ({
      ...current,
      [sessionId]: !(current[sessionId] ?? true)
    }));
  };
  const isSessionCollapsed = (sessionId: string) =>
    collapsedSessions[sessionId] ?? true;
  const formatAverage = (scores: number[]) => {
    if (scores.length === 0) {
      return "—";
    }
    const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const formatted = avg.toFixed(2);
    return formatted.endsWith(".00") ? formatted.slice(0, -3) : formatted;
  };
  const startSessionEdit = (sessionId: string, name?: string | null, description?: string | null) => {
    setEditingSessionId(sessionId);
    setSessionEditName(name?.trim() || "");
    setSessionEditDescription(description?.trim() || "");
    setDeleteSessionId(null);
  };
  const cancelSessionEdit = () => {
    setEditingSessionId(null);
    setSessionEditName("");
    setSessionEditDescription("");
  };
  const saveSessionEdit = async (sessionId: string) => {
    if (savingSessionId) {
      return;
    }
    setSavingSessionId(sessionId);
    setGameError("");
    try {
      const response = await authFetch("/api/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          name: sessionEditName,
          description: sessionEditDescription
        })
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to update session.");
      }
      await loadGames();
      cancelSessionEdit();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update session.";
      setGameError(message);
    } finally {
      setSavingSessionId(null);
    }
  };
  const requestSessionDelete = (sessionId: string) => {
    setDeleteSessionId(sessionId);
    setEditingSessionId(null);
  };
  const cancelSessionDelete = () => {
    setDeleteSessionId(null);
  };
  const handleSessionDelete = async (sessionId: string, mode: "sessionless" | "delete_games") => {
    if (deletingSessionId) {
      return;
    }
    setDeletingSessionId(sessionId);
    setGameError("");
    try {
      const response = await authFetch("/api/session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, mode })
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to delete session.");
      }
      await loadGames();
      setDeleteSessionId(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete session.";
      setGameError(message);
    } finally {
      setDeletingSessionId(null);
    }
  };

  const moveGameToSession = useCallback(
    async (gameId: string, sessionId: string | null) => {
      if (movingGameId) {
        return;
      }
      setMovingGameId(gameId);
      setGameError("");
      try {
        const response = await authFetch("/api/game/session", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId, sessionId })
        });
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error || "Failed to move game.");
        }
        await loadGames();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to move game.";
        setGameError(message);
      } finally {
        setMovingGameId(null);
      }
    },
    [loadGames, movingGameId]
  );
  const sessionGroups = useMemo(() => {
    const sessionMap = new Map<
      string,
      {
        sessionId: string;
        session: GameListItem["session"];
        games: GameListItem[];
      }
    >();
    const sessionless: GameListItem[] = [];

    games.forEach((game) => {
      if (game.session_id) {
        const existing = sessionMap.get(game.session_id);
        if (existing) {
          existing.games.push(game);
        } else {
          sessionMap.set(game.session_id, {
            sessionId: game.session_id,
            session: game.session ?? null,
            games: [game]
          });
        }
      } else {
        sessionless.push(game);
      }
    });

    const sortByPlayedAtAsc = (list: GameListItem[]) =>
      list
        .slice()
        .sort((a, b) => {
          const aDate = Date.parse(a.played_at || a.created_at);
          const bDate = Date.parse(b.played_at || b.created_at);
          return aDate - bDate;
        });

    const getSessionSortDate = (group: {
      session: GameListItem["session"];
      games: GameListItem[];
    }) => {
      if (group.session?.created_at) {
        return Date.parse(group.session.created_at);
      }
      return 0;
    };

    const compareSessions = (
      a: { sessionId: string; session: GameListItem["session"]; games: GameListItem[] },
      b: { sessionId: string; session: GameListItem["session"]; games: GameListItem[] }
    ) => {
      const aDate = getSessionSortDate(a);
      const bDate = getSessionSortDate(b);
      if (aDate !== bDate) {
        return aDate - bDate;
      }
      return a.sessionId.localeCompare(b.sessionId);
    };

    const orderedSessions = Array.from(sessionMap.values()).sort((a, b) => {
      return compareSessions(b, a);
    });

    const sessionNumberById = new Map<string, number>();
    orderedSessions
      .slice()
      .sort(compareSessions)
      .forEach((group, index) => {
        sessionNumberById.set(group.sessionId, index + 1);
      });

    const gameTitleMap = new Map<string, string>();
    orderedSessions.forEach((group) => {
      sortByPlayedAtAsc(group.games).forEach((game, index) => {
        gameTitleMap.set(game.id, `Game ${index + 1}`);
      });
    });
    sortByPlayedAtAsc(sessionless).forEach((game, index) => {
      gameTitleMap.set(game.id, `Game ${index + 1}`);
    });

    return {
      orderedSessions,
      sessionless,
      sortByPlayedAtAsc,
      gameTitleMap,
      sessionNumberById
    };
  }, [games]);
  const displayedSessionCount =
    sessionGroups.orderedSessions.length +
    (sessionGroups.sessionless.length > 0 ? 1 : 0);
  const sessionCountLabel = displayedSessionCount === 1 ? "session" : "sessions";
  const visibleSessions = sessionGroups.orderedSessions;
  const sessionOptions = useMemo(() => {
    return sessionGroups.orderedSessions.map((group) => {
      const sessionLabel =
        group.session?.name?.trim() ||
        `Session ${sessionGroups.sessionNumberById.get(group.sessionId) ?? ""}`.trim();
      return {
        id: group.sessionId,
        label: sessionLabel || "Session"
      };
    });
  }, [sessionGroups]);
  const handleSessionChange = (sessionId: string | null) => {
    setSelectedSessionId(sessionId);
  };
  useEffect(() => {
    if (selectedSessionId === "new") {
      return;
    }
    if (sessionOptions.length === 0) {
      setSelectedSessionId("new");
      return;
    }
    if (
      selectedSessionId &&
      sessionOptions.some((option) => option.id === selectedSessionId)
    ) {
      return;
    }
    setSelectedSessionId("new");
  }, [selectedSessionId, sessionOptions]);
  const handleCreateSession = useCallback(async () => {
    if (creatingSession) {
      return null;
    }
    setCreatingSession(true);
    setGameError("");
    try {
      const response = await authFetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to create session.");
      }
      const payload = (await response.json()) as { session: SessionItem };
      const created = payload.session;
      return created.id;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create session.";
      setGameError(message);
      return null;
    } finally {
      setCreatingSession(false);
    }
  }, [creatingSession]);
  const gameNumberMap = useMemo(() => {
    const ordered = [...games].sort((a, b) => {
      const aTime = a.played_at
        ? Date.parse(a.played_at)
        : Date.parse(a.created_at);
      const bTime = b.played_at
        ? Date.parse(b.played_at)
        : Date.parse(b.created_at);
      return bTime - aTime;
    });
    const total = gamesTotal ?? ordered.length;
    const map = new Map<string, number>();
    ordered.forEach((game, index) => {
      map.set(game.id, total - index);
    });
    return map;
  }, [games, gamesTotal]);
  const formatJobMessage = (job: PendingJob) => {
    if (isDebug) {
      const statusLabel = job.status ? ` Status: ${job.status}.` : "";
      return `${job.message}${statusLabel} Job ID: ${job.jobId}.`;
    }
    if (job.isStale) {
      return "Still queued. Check back later.";
    }
    if (job.status === "queued") {
      return "Queued for extraction.";
    }
    if (job.status === "processing") {
      return "Processing the image...";
    }
    if (job.status === "logged") {
      return "Logged. Ready to review.";
    }
    if (job.status === "error") {
      return job.lastError
        ? `Job failed: ${job.lastError}`
        : "Job failed during processing.";
    }
    return job.message;
  };
  const getGameNumber = (gameId: string) => gameNumberMap.get(gameId) ?? null;
  const registerGameRef = useCallback(
    (gameId: string) => (node: HTMLDivElement | null) => {
      if (node) {
        gameCardRefs.current[gameId] = node;
      } else {
        delete gameCardRefs.current[gameId];
      }
    },
    []
  );
  const registerSessionHeaderRef = useCallback(
    (sessionId: string) => (node: HTMLDivElement | null) => {
      if (node) {
        sessionHeaderRefs.current[sessionId] = node;
      } else {
        delete sessionHeaderRefs.current[sessionId];
      }
    },
    []
  );
  const DraggableGameCard = ({
    game,
    titleOverride
  }: {
    game: GameListItem;
    titleOverride?: string;
  }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } =
      useDraggable({
        id: game.id,
        data: { type: "game", gameId: game.id }
      });
    const style = {
      transform: transform ? CSS.Transform.toString(transform) : undefined
    };

    return (
      <div ref={registerGameRef(game.id)} className="game-card-wrapper">
        <div
          ref={setNodeRef}
          style={style}
          className={`game-card draggable${isDragging ? " dragging" : ""}`}
          {...attributes}
          {...listeners}
        >
          {renderGameCardContent(game, titleOverride)}
        </div>
      </div>
    );
  };

  const activeDragGame = useMemo(() => {
    if (!activeDragGameId) {
      return null;
    }
    return games.find((game) => game.id === activeDragGameId) ?? null;
  }, [activeDragGameId, games]);

  const handleDragStart = (event: DragStartEvent) => {
    if (event.active?.data?.current?.type === "game") {
      setActiveDragGameId(String(event.active.id));
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragGameId(null);
    if (!over) {
      return;
    }
    if (active?.data?.current?.type !== "game") {
      return;
    }
    const overId = String(over.id);
    if (!overId.startsWith("session:")) {
      return;
    }
    const target = overId.replace("session:", "");
    const nextSessionId = target === "sessionless" ? null : target;
    const currentGame = games.find((game) => game.id === active.id);
    const currentSessionId = currentGame?.session_id ?? null;
    if (currentSessionId === nextSessionId) {
      return;
    }
    await moveGameToSession(String(active.id), nextSessionId);
  };
  function renderGameCardContent(
    game: GameListItem,
    titleOverride?: string,
    isOverlay?: boolean
  ) {
    const expanded = expandedGameId === game.id;
    const detail = expandedGames[game.id];
    const rows = detail ? buildScoreRows(detail) : null;
    const gameNumber = getGameNumber(game.id);
    const trimmedName = game.game_name?.trim();
    const gameTitle = titleOverride
      ? titleOverride
      : trimmedName
        ? trimmedName
        : gameNumber
          ? `Game ${gameNumber}`
          : "Game";

    return (
      <>
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
          {!isOverlay ? (
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
          ) : null}
        </div>
        {expanded && !isOverlay ? (
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
      </>
    );
  }

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
        <UploadForm
          onQueued={handleQueued}
          pendingJobsCount={pendingJobs.length}
          sessions={sessionOptions}
          selectedSessionId={selectedSessionId}
          onSessionChange={handleSessionChange}
          onCreateSession={handleCreateSession}
        />
        {reviewGameIds.length > 0 ? (
          <div className="status-stack">
            <button
              type="button"
              className="button-secondary"
              onClick={handleReviewRecentlyLogged}
            >
              Review recently logged games
            </button>
          </div>
        ) : null}
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
                  <span>{formatJobMessage(job)}</span>
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
            {`Showing ${displayedSessionCount} ${sessionCountLabel}.`}
          </p>
        </div>
        {displayGames.length === 0 ? (
          <p className="helper">No games yet.</p>
        ) : (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="session-stack">
              {visibleSessions.map((group) => {
                const sessionId = group.sessionId;
                const collapsed = isSessionCollapsed(sessionId);
                const sortedGames = sessionGroups.sortByPlayedAtAsc(group.games);
                const scores = group.games
                  .map((game) => game.total_score)
                  .filter((score): score is number => typeof score === "number");
                const firstGame = sortedGames[0];
                const firstDateTimeSource =
                  group.session?.started_at ||
                  (firstGame ? firstGame.played_at || firstGame.created_at : null);
                const firstDateTime = firstDateTimeSource
                  ? new Date(firstDateTimeSource).toLocaleString()
                  : null;
                const sessionLabel =
                  group.session?.name?.trim() ||
                  `Session ${sessionGroups.sessionNumberById.get(sessionId) ?? ""}`.trim();
                const isEditing = editingSessionId === sessionId;
                const isDeletePrompt = deleteSessionId === sessionId;
                const isSaving = savingSessionId === sessionId;
                const isDeleting = deletingSessionId === sessionId;
                return (
                  <DroppableContainer
                    key={sessionId}
                    id={`session:${sessionId}`}
                  >
                    {({ setNodeRef, isOver }) => (
                      <div
                        ref={setNodeRef}
                        className={`session-group session-drop-target${
                          isOver ? " is-over" : ""
                        }`}
                      >
                        <div
                          ref={registerSessionHeaderRef(sessionId)}
                          className="session-header"
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleSession(sessionId)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleSession(sessionId);
                            }
                          }}
                        >
                          <div className="session-header-top">
                            <div className="session-header-text">
                              <h3>{sessionLabel || "Session"}</h3>
                              <p className="helper session-meta">
                                <span>{group.games.length} games</span>
                                <span>Avg {formatAverage(scores)}</span>
                                {collapsed && firstDateTime ? (
                                  <span>{firstDateTime}</span>
                                ) : null}
                              </p>
                            </div>
                            <div className="session-actions-inline">
                              {!collapsed ? (
                                <>
                                  <button
                                    type="button"
                                    className="edit-toggle"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      startSessionEdit(
                                        sessionId,
                                        group.session?.name,
                                        group.session?.description
                                      );
                                    }}
                                    aria-label={`Edit ${sessionLabel || "Session"}`}
                                    title={`Edit ${sessionLabel || "Session"}`}
                                    disabled={isSaving || isDeleting}
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
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      requestSessionDelete(sessionId);
                                    }}
                                    aria-label={`Delete ${sessionLabel || "Session"}`}
                                    title={`Delete ${sessionLabel || "Session"}`}
                                    disabled={isSaving || isDeleting}
                                  >
                                    {isDeleting ? (
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
                                </>
                              ) : null}
                              <button
                                type="button"
                                className="expand-toggle"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleSession(sessionId);
                                }}
                                aria-expanded={!collapsed}
                                aria-label={`${collapsed ? "Expand" : "Collapse"} ${sessionLabel || "Session"}`}
                                title={`${collapsed ? "Expand" : "Collapse"} ${sessionLabel || "Session"}`}
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
                          {group.session?.description ? (
                            <p className="helper">{group.session.description}</p>
                          ) : null}
                        </div>
                        {!collapsed ? (
                          <div className="session-body">
                            {isEditing ? (
                              <div className="session-edit">
                                <div className="session-edit-fields">
                                  <div>
                                    <label htmlFor={`session-name-${sessionId}`}>Session name</label>
                                    <input
                                      id={`session-name-${sessionId}`}
                                      type="text"
                                      value={sessionEditName}
                                      onChange={(event) => setSessionEditName(event.target.value)}
                                      placeholder={sessionLabel || "Session name"}
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor={`session-desc-${sessionId}`}>Description</label>
                                    <input
                                      id={`session-desc-${sessionId}`}
                                      type="text"
                                      value={sessionEditDescription}
                                      onChange={(event) =>
                                        setSessionEditDescription(event.target.value)
                                      }
                                      placeholder="Optional description"
                                    />
                                  </div>
                                </div>
                                <div className="session-edit-actions">
                                  <button
                                    type="button"
                                    className="button-secondary"
                                    onClick={cancelSessionEdit}
                                    disabled={isSaving}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => saveSessionEdit(sessionId)}
                                    disabled={isSaving}
                                  >
                                    {isSaving ? "Saving..." : "Save session"}
                                  </button>
                                </div>
                              </div>
                            ) : null}
                            {isDeletePrompt ? (
                              <div className="session-delete">
                                <p className="helper">
                                  Delete this session. What should happen to the games inside?
                                </p>
                                <div className="session-delete-actions">
                                  <button
                                    type="button"
                                    className="button-secondary"
                                    onClick={() => handleSessionDelete(sessionId, "sessionless")}
                                    disabled={isDeleting}
                                  >
                                    Move to sessionless
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSessionDelete(sessionId, "delete_games")}
                                    disabled={isDeleting}
                                  >
                                    Delete permanently
                                  </button>
                                  <button
                                    type="button"
                                    className="button-muted"
                                    onClick={cancelSessionDelete}
                                    disabled={isDeleting}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : null}
                            <div className="games-list">
                              {sortedGames.map((game) => (
                                <DraggableGameCard
                                  key={game.id}
                                  game={game}
                                  titleOverride={sessionGroups.gameTitleMap.get(game.id)}
                                />
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </DroppableContainer>
                );
              })}
              {sessionGroups.sessionless.length > 0 ? (() => {
                const sessionId = "sessionless";
                const collapsed = isSessionCollapsed(sessionId);
                const sortedGames = sessionGroups.sortByPlayedAtAsc(
                  sessionGroups.sessionless
                );
                const scores = sessionGroups.sessionless
                  .map((game) => game.total_score)
                  .filter((score): score is number => typeof score === "number");
                const firstGame = sortedGames[0];
                const firstDateTime = firstGame
                  ? new Date(
                      firstGame.played_at || firstGame.created_at
                    ).toLocaleString()
                  : null;
                return (
                  <DroppableContainer id={`session:${sessionId}`}>
                    {({ setNodeRef, isOver }) => (
                      <div
                        ref={setNodeRef}
                        className={`session-group session-drop-target${
                          isOver ? " is-over" : ""
                        }`}
                      >
                        <div
                          ref={registerSessionHeaderRef(sessionId)}
                          className="session-header"
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleSession(sessionId)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleSession(sessionId);
                            }
                          }}
                        >
                          <div className="session-header-top">
                            <div className="session-header-text">
                              <h3>Sessionless games</h3>
                              <p className="helper session-meta">
                                <span>{sessionGroups.sessionless.length} games</span>
                                <span>Avg {formatAverage(scores)}</span>
                                {collapsed && firstDateTime ? (
                                  <span>{firstDateTime}</span>
                                ) : null}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="expand-toggle"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleSession(sessionId);
                              }}
                              aria-expanded={!collapsed}
                              aria-label={`${collapsed ? "Expand" : "Collapse"} Sessionless games`}
                              title={`${collapsed ? "Expand" : "Collapse"} Sessionless games`}
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
                          <p className="helper">
                            These games were not given a session.
                          </p>
                        </div>
                        {!collapsed ? (
                          <div className="games-list">
                            {sortedGames.map((game) => (
                              <DraggableGameCard
                                key={game.id}
                                game={game}
                                titleOverride={sessionGroups.gameTitleMap.get(game.id)}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </DroppableContainer>
                );
              })() : null}
            </div>
            <DragOverlay>
              {activeDragGame ? (
                <div className="game-card drag-overlay">
                  {renderGameCardContent(
                    activeDragGame,
                    sessionGroups.gameTitleMap.get(activeDragGame.id),
                    true
                  )}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
        {gameError ? <p className="helper error-text">{gameError}</p> : null}
      </section>

      <section className="panel anchor-section" id="chat">
        <ChatPanel gameLabel={activeGameLabel} />
      </section>
    </div>
  );
}



