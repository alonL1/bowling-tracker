"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LaneRule from "../../LaneRule";
import Dashboard from "../../Dashboard";
import { useJobs } from "../../providers/JobsProvider";

export default function GamesSection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loggedVersion } = useJobs();

  const recentGameIds = useMemo(() => {
    const recent = searchParams?.get("recent");
    if (!recent) {
      return [];
    }
    return recent
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }, [searchParams]);

  const handleAutoReviewHandled = useCallback(() => {
    if (!searchParams?.get("recent")) {
      return;
    }
    router.replace("/sessions", { scroll: false });
  }, [router, searchParams]);

  return (
    <section className="screen">
      <header className="screen-header">
        <h1 className="screen-title">Sessions</h1>
        <p className="screen-subtitle">
          Review, edit, and organize your bowling sessions and games.
        </p>
      </header>
      <LaneRule variant="arrows" />
      <Dashboard
        showSubmit={false}
        showChat={false}
        showGames
        showGamesHeader={false}
        gamesContainerClassName="screen-content"
        autoReviewGameIds={recentGameIds}
        onAutoReviewHandled={handleAutoReviewHandled}
        reloadToken={loggedVersion}
      />
    </section>
  );
}
