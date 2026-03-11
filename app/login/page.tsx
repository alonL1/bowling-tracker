"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import LaneRule from "../components/LaneRule";
import {
  authFetch,
  getCurrentUser,
  getSessionSnapshot,
  isGuestUser,
  onClientAuthStateChange,
  signInWithPassword,
  signUpWithPassword
} from "../lib/authClient";

type AuthMode = "sign-in" | "sign-up";

type TransferPrompt = {
  guestAccessToken: string;
  guestUserId: string;
};

function getSafeNextPath() {
  if (typeof window === "undefined") {
    return "/";
  }
  const raw = new URLSearchParams(window.location.search).get("next") ?? "";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }
  if (trimmed.startsWith("/login")) {
    return "/";
  }
  return trimmed || "/";
}

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [transferPrompt, setTransferPrompt] = useState<TransferPrompt | null>(
    null
  );
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState("");

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (!mounted) {
          return;
        }
        setUser(currentUser);
      } catch (error) {
        if (!mounted) {
          return;
        }
        setAuthError(
          error instanceof Error ? error.message : "Failed to initialize auth."
        );
      } finally {
        if (mounted) {
          setAuthLoading(false);
        }
      }
    };

    initialize();
    const { data: subscription } = onClientAuthStateChange((nextUser) => {
      setUser(nextUser);
      setAuthError("");
    });
    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (authBusy || transferBusy) {
      return;
    }
    if (transferPrompt) {
      return;
    }
    if (user && !isGuestUser(user)) {
      router.replace(getSafeNextPath());
    }
  }, [authLoading, authBusy, transferBusy, transferPrompt, user, router]);

  const handleAuthSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authBusy || transferBusy || transferPrompt) {
      return;
    }

    setAuthBusy(true);
    setAuthError("");
    setAuthInfo("");
    setTransferError("");

    try {
      const beforeSession = await getSessionSnapshot();
      const guestBefore =
        beforeSession.user &&
        beforeSession.accessToken &&
        isGuestUser(beforeSession.user)
          ? {
              guestAccessToken: beforeSession.accessToken,
              guestUserId: beforeSession.user.id
            }
          : null;

      if (authMode === "sign-in") {
        await signInWithPassword(email.trim(), password);
      } else {
        await signUpWithPassword(email.trim(), password);
      }

      const afterSession = await getSessionSnapshot();
      const nextUser = afterSession.user;
      setUser(nextUser);

      if (nextUser && !isGuestUser(nextUser)) {
        if (guestBefore && guestBefore.guestUserId !== nextUser.id) {
          let hasGuestData = true;
          try {
            const checkResponse = await authFetch("/api/auth/claim-guest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                guestAccessToken: guestBefore.guestAccessToken,
                action: "check"
              })
            });
            const checkPayload = (await checkResponse.json()) as {
              error?: string;
              check?: { total?: number };
            };
            if (!checkResponse.ok) {
              throw new Error(
                checkPayload.error || "Failed to check guest logs."
              );
            }
            hasGuestData = (checkPayload.check?.total ?? 0) > 0;
          } catch {
            hasGuestData = true;
          }

          if (!hasGuestData) {
            router.replace(getSafeNextPath());
            return;
          }

          setTransferPrompt({
            guestAccessToken: guestBefore.guestAccessToken,
            guestUserId: guestBefore.guestUserId
          });
          setAuthInfo(
            "You're signed in. Choose what to do with your guest logs."
          );
          return;
        }
        router.replace(getSafeNextPath());
        return;
      }

      if (authMode === "sign-up") {
        setAuthInfo(
          "Account created. If email confirmation is enabled, check your inbox."
        );
      } else {
        setAuthInfo(
          "Sign-in did not create an account session yet. If confirmation is required, complete it first."
        );
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Auth failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleStartBlank = () => {
    if (transferBusy) {
      return;
    }
    setTransferPrompt(null);
    setTransferError("");
    router.replace(getSafeNextPath());
  };

  const handleSaveLogs = async () => {
    if (!transferPrompt || transferBusy) {
      return;
    }
    setTransferBusy(true);
    setTransferError("");
    try {
      const response = await authFetch("/api/auth/claim-guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestAccessToken: transferPrompt.guestAccessToken
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to move guest logs.");
      }
      setTransferPrompt(null);
      router.replace(getSafeNextPath());
    } catch (error) {
      setTransferError(
        error instanceof Error ? error.message : "Failed to move guest logs."
      );
    } finally {
      setTransferBusy(false);
    }
  };

  const isGuest = isGuestUser(user);

  if (authLoading) {
    return (
      <main className="container">
        <div className="loading-row">
          <span className="spinner spinner-muted" aria-hidden="true" />
          <span className="helper">Loading account...</span>
        </div>
      </main>
    );
  }

  if (user && !isGuest && !transferPrompt) {
    return (
      <main className="container">
        <div className="loading-row">
          <span className="spinner spinner-muted" aria-hidden="true" />
          <span className="helper">Redirecting to sessions...</span>
        </div>
      </main>
    );
  }

  return (
    <main className="container auth-shell">
      <section className="screen auth-shell-content">
        <header className="screen-header">
          <p className="eyebrow">Bowling Tracker</p>
          <h1 className="screen-title">Sign in to your bowling account.</h1>
          <p className="screen-subtitle">
            Keep your games private, track sessions, and chat with an AI pin about your stats.
          </p>
        </header>
        <LaneRule variant="arrows" />
        <div className="section-block auth-card">
          <h2>{authMode === "sign-in" ? "Sign In" : "Create Account"}</h2>
          <form className="form-grid" onSubmit={handleAuthSubmit}>
            <div>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete={
                  authMode === "sign-in" ? "current-password" : "new-password"
                }
              />
            </div>
            <div className="full auth-actions">
              <button
                type="submit"
                disabled={authBusy || transferBusy || Boolean(transferPrompt)}
              >
                {authBusy
                  ? authMode === "sign-in"
                    ? "Signing in..."
                    : "Creating..."
                  : authMode === "sign-in"
                    ? "Sign In"
                    : "Create Account"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() =>
                  setAuthMode((current) =>
                    current === "sign-in" ? "sign-up" : "sign-in"
                  )
                }
                disabled={authBusy || transferBusy || Boolean(transferPrompt)}
              >
                {authMode === "sign-in" ? "Need an account?" : "Have an account?"}
              </button>
            </div>
            {authError ? <p className="helper error-text">{authError}</p> : null}
            {authInfo ? <p className="helper">{authInfo}</p> : null}
            {isGuest ? (
              <p className="helper">
                You are currently using a guest session.
              </p>
            ) : null}
          </form>
        </div>
      </section>

      {transferPrompt ? (
        <div className="auth-modal-backdrop" role="presentation">
          <section
            className="auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guest-transfer-title"
          >
            <h3 id="guest-transfer-title">Move guest logs to this account?</h3>
            <p className="helper">
              You are signed in. Do you want to move your guest sessions and
              games to this account, or keep this account as-is?
            </p>
            <LaneRule variant="dots" className="lane-rule-inline" />
            <div className="auth-actions">
              <button type="button" onClick={handleSaveLogs} disabled={transferBusy}>
                {transferBusy ? "Saving logs..." : "Save my logs"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={handleStartBlank}
                disabled={transferBusy}
              >
                Skip import
              </button>
            </div>
            {transferError ? (
              <p className="helper error-text">{transferError}</p>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
