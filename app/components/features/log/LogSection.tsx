"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import UploadForm from "../../UploadForm";
import { useGames } from "../../providers/GamesProvider";
import { useJobs } from "../../providers/JobsProvider";
import type { PendingJob } from "../../types/app";

const formatJobMessage = (job: PendingJob, isDebug: boolean) => {
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

export default function LogSection() {
  const router = useRouter();
  const { games, isGamesLoading, gameError, setGameError, createSession, loadGames } =
    useGames();
  const {
    pendingJobs,
    enqueueJobs,
    recentlyLoggedGameIds,
    clearRecentlyLoggedGameIds
  } = useJobs();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const isDebug = process.env.CHAT_DEBUG === "true";

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  const sessionGroups = useMemo(() => {
    const sessionMap = new Map<
      string,
      {
        sessionId: string;
        session: (typeof games)[number]["session"];
        games: typeof games;
      }
    >();

    games.forEach((game) => {
      if (!game.session_id) {
        return;
      }
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
    });

    const compareSessions = (
      a: {
        sessionId: string;
        session: (typeof games)[number]["session"];
      },
      b: {
        sessionId: string;
        session: (typeof games)[number]["session"];
      }
    ) => {
      const aDate = a.session?.created_at ? Date.parse(a.session.created_at) : 0;
      const bDate = b.session?.created_at ? Date.parse(b.session.created_at) : 0;
      if (aDate !== bDate) {
        return aDate - bDate;
      }
      return a.sessionId.localeCompare(b.sessionId);
    };

    const orderedSessions = Array.from(sessionMap.values()).sort((a, b) =>
      compareSessions(b, a)
    );

    const sessionNumberById = new Map<string, number>();
    orderedSessions
      .slice()
      .sort(compareSessions)
      .forEach((group, index) => {
        sessionNumberById.set(group.sessionId, index + 1);
      });

    return { orderedSessions, sessionNumberById };
  }, [games]);

  const sessionOptions = useMemo(() => {
    return sessionGroups.orderedSessions.map((group) => {
      const label =
        group.session?.name?.trim() ||
        `Session ${sessionGroups.sessionNumberById.get(group.sessionId) ?? ""}`.trim();
      return {
        id: group.sessionId,
        label: label || "Session"
      };
    });
  }, [sessionGroups]);

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

  const handleCreateSession = async () => {
    const created = await createSession();
    if (!created) {
      return null;
    }
    return created.id;
  };

  const handleReviewRecentlyLogged = () => {
    if (recentlyLoggedGameIds.length === 0) {
      return;
    }
    const query = recentlyLoggedGameIds.join(",");
    clearRecentlyLoggedGameIds();
    router.push(`/games?recent=${encodeURIComponent(query)}`);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Log a game</h2>
        <p className="helper">
          Upload a scoreboard image, then wait for the worker to finish. <br />
          To add multiple games at once simply select multiple images. <br />
          If have different names throughout the scoresheets, write them out comma
          seperated
        </p>
      </div>
      <UploadForm
        onQueued={enqueueJobs}
        onError={setGameError}
        pendingJobsCount={pendingJobs.length}
        sessions={sessionOptions}
        isSessionsLoading={isGamesLoading}
        selectedSessionId={selectedSessionId}
        onSessionChange={setSelectedSessionId}
        onCreateSession={handleCreateSession}
      />

      {recentlyLoggedGameIds.length > 0 ? (
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
              className={`status${job.status === "error" ? " error" : ""}`}
            >
              {formatJobMessage(job, isDebug)}
            </div>
          ))}
        </div>
      ) : null}

      {gameError ? <p className="helper error-text">{gameError}</p> : null}
    </section>
  );
}
