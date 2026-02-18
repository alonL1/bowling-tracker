"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Dashboard from "../../Dashboard";
import { useJobs } from "../../providers/JobsProvider";

export default function GamesSection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loggedVersion } = useJobs();

  const recentGameIds = useMemo(() => {
    const recent = searchParams.get("recent");
    if (!recent) {
      return [];
    }
    return recent
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }, [searchParams]);

  const handleAutoReviewHandled = useCallback(() => {
    if (!searchParams.get("recent")) {
      return;
    }
    router.replace("/games", { scroll: false });
  }, [router, searchParams]);

  return (
    <Dashboard
      showSubmit={false}
      showChat={false}
      showGames
      autoReviewGameIds={recentGameIds}
      onAutoReviewHandled={handleAutoReviewHandled}
      reloadToken={loggedVersion}
    />
  );
}
