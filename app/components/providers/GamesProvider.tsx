"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authFetch } from "../../lib/authClient";
import type { GameDetail, GameListItem, SessionItem } from "../types/app";

type GamesContextValue = {
  games: GameListItem[];
  gamesTotal: number | null;
  isGamesLoading: boolean;
  gameError: string;
  setGameError: (message: string) => void;
  loadGames: () => Promise<void>;
  loadGameById: (gameId: string) => Promise<GameDetail | null>;
  loadGameFromJobId: (jobId: string) => Promise<GameDetail | null>;
  createSession: () => Promise<SessionItem | null>;
  updateSession: (
    sessionId: string,
    name: string,
    description: string
  ) => Promise<SessionItem | null>;
  deleteSession: (
    sessionId: string,
    mode: "sessionless" | "delete_games"
  ) => Promise<boolean>;
  moveGameToSession: (
    gameId: string,
    sessionId: string | null
  ) => Promise<boolean>;
  deleteGame: (gameId: string) => Promise<boolean>;
};

const GamesContext = createContext<GamesContextValue | null>(null);

async function parseJsonResponse<T>(response: Response) {
  const raw = await response.text();
  if (!raw) {
    return {} as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Request failed with non-JSON response (${response.status}).`);
  }
}

export function GamesProvider({ children }: { children: React.ReactNode }) {
  const [games, setGames] = useState<GameListItem[]>([]);
  const [gamesTotal, setGamesTotal] = useState<number | null>(null);
  const [isGamesLoading, setIsGamesLoading] = useState<boolean>(true);
  const [gameError, setGameErrorState] = useState<string>("");

  const setGameError = useCallback((message: string) => {
    setGameErrorState(message);
  }, []);

  const loadGames = useCallback(async () => {
    setIsGamesLoading(true);
    try {
      const response = await authFetch("/api/games");
      if (!response.ok) {
        const payload = await parseJsonResponse<{ error?: string }>(response);
        throw new Error(payload.error || "Failed to load games.");
      }
      const payload = await parseJsonResponse<{
        games?: GameListItem[];
        count?: number | null;
      }>(response);
      setGames(payload.games || []);
      setGamesTotal(typeof payload.count === "number" ? payload.count : null);
      setGameErrorState("");
    } catch (error) {
      setGameErrorState(
        error instanceof Error ? error.message : "Failed to load games."
      );
      setGamesTotal(null);
    } finally {
      setIsGamesLoading(false);
    }
  }, []);

  const loadGameById = useCallback(async (gameId: string) => {
    const response = await authFetch(`/api/game?gameId=${gameId}`);
    if (!response.ok) {
      const payload = await parseJsonResponse<{ error?: string }>(response);
      throw new Error(payload.error || "Failed to load game.");
    }
    const payload = await parseJsonResponse<{ game: GameDetail }>(response);
    return payload.game;
  }, []);

  const loadGameFromJobId = useCallback(async (jobId: string) => {
    const response = await authFetch(`/api/game?jobId=${jobId}`);
    if (!response.ok) {
      const payload = await parseJsonResponse<{ error?: string }>(response);
      throw new Error(payload.error || "Failed to load game.");
    }
    const payload = await parseJsonResponse<{ game: GameDetail }>(response);
    return payload.game;
  }, []);

  const createSession = useCallback(async () => {
    try {
      const response = await authFetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!response.ok) {
        const payload = await parseJsonResponse<{ error?: string }>(response);
        throw new Error(payload.error || "Failed to create session.");
      }
      const payload = await parseJsonResponse<{ session: SessionItem }>(response);
      await loadGames();
      return payload.session;
    } catch (error) {
      setGameErrorState(
        error instanceof Error ? error.message : "Failed to create session."
      );
      return null;
    }
  }, [loadGames]);

  const updateSession = useCallback(
    async (sessionId: string, name: string, description: string) => {
      try {
        const response = await authFetch("/api/session", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, name, description })
        });
        if (!response.ok) {
          const payload = await parseJsonResponse<{ error?: string }>(response);
          throw new Error(payload.error || "Failed to update session.");
        }
        const payload = await parseJsonResponse<{ session: SessionItem }>(response);
        await loadGames();
        return payload.session;
      } catch (error) {
        setGameErrorState(
          error instanceof Error ? error.message : "Failed to update session."
        );
        return null;
      }
    },
    [loadGames]
  );

  const deleteSession = useCallback(
    async (sessionId: string, mode: "sessionless" | "delete_games") => {
      try {
        const response = await authFetch("/api/session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, mode })
        });
        if (!response.ok) {
          const payload = await parseJsonResponse<{ error?: string }>(response);
          throw new Error(payload.error || "Failed to delete session.");
        }
        await loadGames();
        return true;
      } catch (error) {
        setGameErrorState(
          error instanceof Error ? error.message : "Failed to delete session."
        );
        return false;
      }
    },
    [loadGames]
  );

  const moveGameToSession = useCallback(
    async (gameId: string, sessionId: string | null) => {
      const sourceGame = games.find((game) => game.id === gameId);
      const previousSessionId = sourceGame?.session_id ?? null;
      if (!sourceGame || previousSessionId === sessionId) {
        return true;
      }
      const targetSessionMeta =
        sessionId === null
          ? null
          : games.find((game) => game.session_id === sessionId)?.session ?? null;

      setGames((current) =>
        current.map((game) =>
          game.id === gameId
            ? {
                ...game,
                session_id: sessionId,
                session: targetSessionMeta
              }
            : game
        )
      );

      try {
        const response = await authFetch("/api/game/session", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId, sessionId })
        });
        if (!response.ok) {
          const payload = await parseJsonResponse<{ error?: string }>(response);
          throw new Error(payload.error || "Failed to move game.");
        }
        void loadGames();
        return true;
      } catch (error) {
        setGames((current) =>
          current.map((game) =>
            game.id === gameId
              ? {
                  ...game,
                  session_id: previousSessionId,
                  session: sourceGame.session ?? null
                }
              : game
          )
        );
        setGameErrorState(
          error instanceof Error ? error.message : "Failed to move game."
        );
        return false;
      }
    },
    [games, loadGames]
  );

  const deleteGame = useCallback(
    async (gameId: string) => {
      try {
        const response = await authFetch("/api/game", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId })
        });
        if (!response.ok) {
          const payload = await parseJsonResponse<{ error?: string }>(response);
          throw new Error(payload.error || "Failed to delete game.");
        }
        await loadGames();
        return true;
      } catch (error) {
        setGameErrorState(
          error instanceof Error ? error.message : "Failed to delete game."
        );
        return false;
      }
    },
    [loadGames]
  );

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  const value = useMemo<GamesContextValue>(
    () => ({
      games,
      gamesTotal,
      isGamesLoading,
      gameError,
      setGameError,
      loadGames,
      loadGameById,
      loadGameFromJobId,
      createSession,
      updateSession,
      deleteSession,
      moveGameToSession,
      deleteGame
    }),
    [
      games,
      gamesTotal,
      isGamesLoading,
      gameError,
      setGameError,
      loadGames,
      loadGameById,
      loadGameFromJobId,
      createSession,
      updateSession,
      deleteSession,
      moveGameToSession,
      deleteGame
    ]
  );

  return <GamesContext.Provider value={value}>{children}</GamesContext.Provider>;
}

export function useGames() {
  const context = useContext(GamesContext);
  if (!context) {
    throw new Error("useGames must be used within a GamesProvider.");
  }
  return context;
}
