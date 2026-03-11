"use client";

import { Icon } from "@iconify/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch } from "../../../lib/authClient";
import type {
  InviteLinkResponse,
  LeaderboardMetric,
  LeaderboardRow
} from "../../types/app";
import { useAuth } from "../../providers/AuthProvider";

type LeaderboardResponse = {
  selfUserId: string;
  participants: LeaderboardRow[];
};

type RankedRow = LeaderboardRow & {
  rank: number;
  metricValue: number;
};

const METRIC_TABS: Array<{
  metric: LeaderboardMetric;
  label: string;
  description: string;
}> = [
  {
    metric: "bestGame",
    label: "Score",
    description: "Highest Scoring Game"
  },
  {
    metric: "bestAverage",
    label: "Average",
    description: "Average Score Across All Games"
  },
  {
    metric: "bestSession",
    label: "Best Session",
    description: "Best Single Session Average Score"
  },
  {
    metric: "mostGames",
    label: "Games",
    description: "Total Games Logged"
  },
  {
    metric: "mostSessions",
    label: "Sessions",
    description: "Total Sessions Logged"
  },
  {
    metric: "SessionScore",
    label: "Session Score",
    description: "Most Points Scored in a Session"
  },
  {
    metric: "TotalPoints",
    label: "Points",
    description: "Total Points Across All Games"
  },
  {
    metric: "SessionLength",
    label: "Session Length",
    description: "Most Games Played in a Session"
  },
  {
    metric: "StrikeRate",
    label: "Strike Rate",
    description: "Strike Rate"
  },
  {
    metric: "SpareRate",
    label: "Spare Rate",
    description: "Spare Rate"
  },
  {
    metric: "TotalStrikes",
    label: "Total Strikes",
    description: "Total Number of Strikes"
  },
  {
    metric: "TotalSpares",
    label: "Total Spares",
    description: "Total Number of Spares"
  },
  {
    metric: "MostNines",
    label: "9 King",
    description: "Total Frames with Score of 9"
  }

];

function getMetricValue(row: LeaderboardRow, metric: LeaderboardMetric) {
  return row.metrics[metric] ?? 0;
}

function formatMetricValue(metric: LeaderboardMetric, value: number) {
  if (
    metric === "bestAverage" ||
    metric === "bestSession" ||
    metric === "StrikeRate" ||
    metric === "SpareRate"
  ) {
    const formatted = value
      .toFixed(2)
      .replace(/\.00$/, "")
      .replace(/(\.\d)0$/, "$1");
    if (metric === "StrikeRate" || metric === "SpareRate") {
      return `${formatted}%`;
    }
    return formatted;
  }
  return Math.round(value).toLocaleString();
}

export default function FriendsSection() {
  const router = useRouter();
  const { user, isGuest, loading: authLoading } = useAuth();

  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const [inviteStatus, setInviteStatus] = useState("");

  const [selectedMetric, setSelectedMetric] =
    useState<LeaderboardMetric>("bestGame");
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [selfUserId, setSelfUserId] = useState<string>("");
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState("");

  const loadLeaderboard = useCallback(async () => {
    if (!user || isGuest) {
      setLeaderboardRows([]);
      setSelfUserId("");
      setLeaderboardError("Sign in to compare stats with friends.");
      setLeaderboardLoading(false);
      return;
    }

    setLeaderboardLoading(true);
    setLeaderboardError("");
    try {
      const response = await authFetch("/api/friends/leaderboard");
      const payload = (await response.json()) as {
        error?: string;
      } & Partial<LeaderboardResponse>;
      if (!response.ok || !payload.selfUserId) {
        throw new Error(payload.error || "Failed to load leaderboard.");
      }
      setSelfUserId(payload.selfUserId);
      setLeaderboardRows(Array.isArray(payload.participants) ? payload.participants : []);
    } catch (error) {
      setLeaderboardError(
        error instanceof Error ? error.message : "Failed to load leaderboard."
      );
      setLeaderboardRows([]);
      setSelfUserId("");
    } finally {
      setLeaderboardLoading(false);
    }
  }, [isGuest, user]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    void loadLeaderboard();
  }, [authLoading, loadLeaderboard]);

  const rankedRows = useMemo<RankedRow[]>(() => {
    const sorted = [...leaderboardRows].sort((left, right) => {
      const valueDelta =
        getMetricValue(right, selectedMetric) - getMetricValue(left, selectedMetric);
      if (valueDelta !== 0) {
        return valueDelta;
      }
      const nameDelta = left.displayName.localeCompare(right.displayName, undefined, {
        sensitivity: "base"
      });
      if (nameDelta !== 0) {
        return nameDelta;
      }
      return left.userId.localeCompare(right.userId);
    });

    let previousValue: number | null = null;
    let previousRank = 0;

    return sorted.map((row, index) => {
      const metricValue = getMetricValue(row, selectedMetric);
      const rank =
        index === 0
          ? 1
          : previousValue !== null && metricValue === previousValue
            ? previousRank
            : index + 1;
      previousValue = metricValue;
      previousRank = rank;
      return {
        ...row,
        rank,
        metricValue
      };
    });
  }, [leaderboardRows, selectedMetric]);

  const yourRank = useMemo(() => {
    const row = rankedRows.find((entry) => entry.userId === selfUserId);
    return row?.rank ?? null;
  }, [rankedRows, selfUserId]);
  const selectedMetricDetail = useMemo(
    () =>
      METRIC_TABS.find((entry) => entry.metric === selectedMetric) ??
      METRIC_TABS[0],
    [selectedMetric]
  );

  const handleInviteFriend = async () => {
    if (inviteBusy) {
      return;
    }
    if (isGuest) {
      router.push("/login?next=%2Ffriends");
      return;
    }

    setInviteBusy(true);
    setInviteError("");
    setInviteStatus("");
    try {
      const response = await authFetch("/api/friends/invite", { method: "POST" });
      const payload = (await response.json()) as InviteLinkResponse & {
        error?: string;
      };
      if (!response.ok || !payload.inviteUrl) {
        throw new Error(payload.error || "Failed to create invite link.");
      }
      setInviteLink(payload.inviteUrl);
      setInvitePanelOpen(true);
    } catch (error) {
      setInviteError(
        error instanceof Error ? error.message : "Failed to create invite link."
      );
    } finally {
      setInviteBusy(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteLink) {
      return;
    }
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard is unavailable.");
      }
      await navigator.clipboard.writeText(inviteLink);
      setInviteStatus("Invite link copied.");
    } catch (error) {
      setInviteStatus(
        error instanceof Error ? error.message : "Copy failed. Copy manually."
      );
    }
  };

  const handleShareInvite = async () => {
    if (!inviteLink) {
      return;
    }
    try {
      if (!navigator?.share) {
        await handleCopyInvite();
        return;
      }
      await navigator.share({
        title: "Bowling Tracker",
        text: "Join my bowling tracker friends list.",
        url: inviteLink
      });
      setInviteStatus("Invite shared.");
    } catch {
      // Ignore dismissed share dialogs.
    }
  };

  return (
    <section className="screen friends-screen">
      <header className="screen-header friends-header-row">
        <h1 className="screen-title">Friends</h1>
        <button
          type="button"
          className="friends-invite-button"
          onClick={handleInviteFriend}
          disabled={authLoading || inviteBusy}
        >
          <span className="button-content">
            <Icon icon="ic:baseline-add" width="20" height="20" aria-hidden="true" />
            {inviteBusy ? "Creating invite..." : "Invite friend"}
          </span>
        </button>
      </header>

      {inviteError ? <p className="helper error-text">{inviteError}</p> : null}

      <section className="friends-tabs" aria-label="Leaderboard categories">
        {METRIC_TABS.map((tab) => (
          <button
            key={tab.metric}
            type="button"
            className={`friends-tab${selectedMetric === tab.metric ? " active" : ""}`}
            onClick={() => setSelectedMetric(tab.metric)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      <section className="friends-metric-summary">
        <p className="friends-metric-description">
          {selectedMetricDetail.description}
        </p>
        <p className="friends-rank-value">{yourRank !== null ? `#${yourRank}` : "--"}</p>
      </section>

      {invitePanelOpen && inviteLink ? (
        <section className="section-block friends-invite-panel">
          <button
            type="button"
            className="friends-invite-close"
            onClick={() => setInvitePanelOpen(false)}
            aria-label="Close invite panel"
          >
            <Icon icon="mdi:close" width="20" height="20" aria-hidden="true" />
          </button>
          <h2>Send your friends a link</h2>
          <div className="friends-invite-actions">
            <button type="button" onClick={handleCopyInvite}>
              Copy link
            </button>
            <button type="button" className="button-secondary" onClick={handleShareInvite}>
              Share link
            </button>
          </div>
          {inviteStatus ? <p className="helper">{inviteStatus}</p> : null}
        </section>
      ) : null}

      {authLoading || leaderboardLoading ? (
        <div className="loading-row">
          <span className="spinner spinner-muted" aria-hidden="true" />
          <span className="helper">Loading leaderboard...</span>
        </div>
      ) : null}

      {leaderboardError && !leaderboardLoading ? (
        <section className="section-block">
          <p className="helper error-text">{leaderboardError}</p>
          {isGuest ? (
            <button type="button" onClick={() => router.push("/login?next=%2Ffriends")}>
              Sign in / Create account
            </button>
          ) : (
            <button type="button" className="button-secondary" onClick={() => void loadLeaderboard()}>
              Retry
            </button>
          )}
        </section>
      ) : null}

      {!leaderboardLoading && !leaderboardError ? (
        <section className="friends-leaderboard">
          <ul className="friends-list">
            {rankedRows.map((row) => (
              <li key={row.userId} className="friends-row">
                <span className="friends-row-rank">{row.rank}</span>
                <span className="friends-row-name">{row.displayName}</span>
                <span className="friends-row-value">
                  {formatMetricValue(selectedMetric, row.metricValue)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
