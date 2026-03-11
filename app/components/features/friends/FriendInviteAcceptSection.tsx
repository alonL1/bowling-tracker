"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch } from "../../../lib/authClient";
import { useAuth } from "../../providers/AuthProvider";
import type { InviteLookupResponse } from "../../types/app";

type AcceptResponse = {
  ok?: boolean;
  alreadyFriends?: boolean;
  error?: string;
};

export default function FriendInviteAcceptSection({ token }: { token: string }) {
  const router = useRouter();
  const { loading: authLoading, isGuest } = useAuth();

  const [lookupLoading, setLookupLoading] = useState(true);
  const [lookupError, setLookupError] = useState("");
  const [lookup, setLookup] = useState<InviteLookupResponse | null>(null);

  const [acceptBusy, setAcceptBusy] = useState(false);
  const [acceptMessage, setAcceptMessage] = useState("");
  const [acceptError, setAcceptError] = useState("");

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (isGuest) {
      const nextPath = encodeURIComponent(`/friends/invite/${token}`);
      router.replace(`/login?next=${nextPath}`);
      return;
    }

    let mounted = true;
    const loadInvite = async () => {
      setLookupLoading(true);
      setLookupError("");
      try {
        const response = await authFetch(`/api/friends/invite/${token}`);
        const payload = (await response.json()) as InviteLookupResponse;
        if (!response.ok || !payload.valid) {
          throw new Error(payload.error || "Invite link is invalid.");
        }
        if (!mounted) {
          return;
        }
        setLookup(payload);
      } catch (error) {
        if (!mounted) {
          return;
        }
        setLookup(null);
        setLookupError(
          error instanceof Error ? error.message : "Failed to load invite."
        );
      } finally {
        if (mounted) {
          setLookupLoading(false);
        }
      }
    };

    void loadInvite();
    return () => {
      mounted = false;
    };
  }, [authLoading, isGuest, router, token]);

  const handleAccept = async () => {
    if (acceptBusy) {
      return;
    }
    setAcceptBusy(true);
    setAcceptError("");
    setAcceptMessage("");

    try {
      const response = await authFetch(`/api/friends/invite/${token}/accept`, {
        method: "POST"
      });
      const payload = (await response.json()) as AcceptResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to accept invite.");
      }
      setAcceptMessage(
        payload.alreadyFriends ? "You are already friends." : "You are now friends."
      );
      setLookup((current) =>
        current
          ? {
              ...current,
              canAccept: false,
              alreadyFriends: true
            }
          : current
      );
    } catch (error) {
      setAcceptError(
        error instanceof Error ? error.message : "Failed to accept invite."
      );
    } finally {
      setAcceptBusy(false);
    }
  };

  return (
    <section className="screen">
      <header className="screen-header">
        <h1 className="screen-title">Friend Invite</h1>
        <p className="screen-subtitle">
          Accept the invite to add this bowler to your friends leaderboard.
        </p>
      </header>

      {lookupLoading ? (
        <div className="loading-row">
          <span className="spinner spinner-muted" aria-hidden="true" />
          <span className="helper">Loading invite...</span>
        </div>
      ) : null}

      {!lookupLoading ? (
        <section className="section-block">
          {lookupError ? <p className="helper error-text">{lookupError}</p> : null}

          {lookup?.inviter ? (
            <p>
              <strong>{lookup.inviter.displayName}</strong> invited you to connect.
            </p>
          ) : null}

          {lookup?.selfInvite ? (
            <p className="helper">You cannot accept your own invite link.</p>
          ) : null}

          {lookup?.alreadyFriends ? (
            <p className="helper">You are already friends.</p>
          ) : null}

          {lookup?.canAccept ? (
            <button type="button" onClick={handleAccept} disabled={acceptBusy}>
              {acceptBusy ? "Accepting..." : "Accept friend request"}
            </button>
          ) : null}

          {acceptMessage ? <p className="helper">{acceptMessage}</p> : null}
          {acceptError ? <p className="helper error-text">{acceptError}</p> : null}

          <button
            type="button"
            className="button-secondary"
            onClick={() => router.push("/friends")}
          >
            Go to Friends
          </button>
        </section>
      ) : null}
    </section>
  );
}
