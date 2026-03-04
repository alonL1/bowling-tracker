"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import LaneRule from "../../LaneRule";
import UploadForm from "../../UploadForm";
import { useGames } from "../../providers/GamesProvider";
import { useJobs } from "../../providers/JobsProvider";
import type { PendingJob } from "../../types/app";

type SessionMode = "auto" | "new" | "existing";

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
  const { games, isGamesLoading, gameError, setGameError, loadGames } =
    useGames();
  const {
    pendingJobs,
    enqueueJobs,
    recentlyLoggedGameIds,
    clearRecentlyLoggedGameIds
  } = useJobs();
  const [sessionMode, setSessionMode] = useState<SessionMode>("new");
  const [selectedExistingSessionId, setSelectedExistingSessionId] = useState<
    string | null
  >(null);
  const [isHelpExpanded, setIsHelpExpanded] = useState(false);
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
    if (sessionOptions.length === 0) {
      setSelectedExistingSessionId(null);
      setSessionMode((current) => (current === "existing" ? "new" : current));
      return;
    }
    if (
      selectedExistingSessionId &&
      sessionOptions.some((option) => option.id === selectedExistingSessionId)
    ) {
      return;
    }
    setSelectedExistingSessionId(sessionOptions[0]?.id ?? null);
  }, [selectedExistingSessionId, sessionOptions]);

  const handleReviewRecentlyLogged = () => {
    if (recentlyLoggedGameIds.length === 0) {
      return;
    }
    const query = recentlyLoggedGameIds.join(",");
    clearRecentlyLoggedGameIds();
    router.push(`/sessions?recent=${encodeURIComponent(query)}`);
  };

  return (
    <section className="screen">
      <header className="screen-header">
        <h1 className="screen-title">Record</h1>
        <p className="screen-subtitle">
          Record new games and add them to your personal log.
        </p>
      </header>
      <LaneRule variant="arrows" />
      <div className="section-stack">
        <div className="collapsible-header">
          <button
            type="button"
            className="button-secondary collapsible-toggle"
            aria-expanded={isHelpExpanded}
            onClick={() => setIsHelpExpanded((current) => !current)}
          >
            <span>Help</span>
            <span className="expand-toggle" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path
                  d="M9 6l6 6-6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        </div>
        {isHelpExpanded ? (
          <div className="collapsible-help">
            <p className="helper">
              Choose Auto Session, New Session, or add games to an existing
              session.
            </p>
            <p className="helper">
              Upload scoreboard images, then wait for the worker to finish.
            </p>
            <p className="helper">
              To add multiple games at once, simply select multiple images.
            </p>
            <p className="helper">
              If you have different names throughout the scoresheets, write them out
              comma separated.
            </p>
          </div>
        ) : null}
      </div>
      <div className="section-block">
        <UploadForm
          onQueued={enqueueJobs}
          onError={setGameError}
          pendingJobsCount={pendingJobs.length}
          sessions={sessionOptions}
          isSessionsLoading={isGamesLoading}
          sessionMode={sessionMode}
          onSessionModeChange={setSessionMode}
          selectedExistingSessionId={selectedExistingSessionId}
          onExistingSessionChange={setSelectedExistingSessionId}
        />
      </div>

      {recentlyLoggedGameIds.length > 0 ? (
        <div className="section-stack">
          <LaneRule variant="dots" />
          <div className="status-stack">
            <button
              type="button"
              className="button-secondary"
              onClick={handleReviewRecentlyLogged}
            >
              Review recently logged games
            </button>
          </div>
        </div>
      ) : null}

      {pendingJobs.length > 0 ? (
        <div className="section-stack">
          <LaneRule variant="dots" />
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
        </div>
      ) : null}

      {gameError ? (
        <div className="section-stack">
          {(recentlyLoggedGameIds.length === 0 && pendingJobs.length === 0) ? (
            <LaneRule variant="dots" />
          ) : null}
          <p className="helper error-text">{gameError}</p>
        </div>
      ) : null}
    </section>
  );
}
