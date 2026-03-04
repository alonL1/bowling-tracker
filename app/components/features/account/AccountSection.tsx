"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import LaneRule from "../../LaneRule";
import { useAuth } from "../../providers/AuthProvider";

export default function AccountSection() {
  const router = useRouter();
  const { user, isGuest, signOutToGuestSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSignOut = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await signOutToGuestSession();
      router.replace("/");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to sign out."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="screen">
      <header className="screen-header">
        <h1 className="screen-title">Account</h1>
        <p className="screen-subtitle">
          {isGuest
            ? "You are currently using a guest session."
            : "You are signed into your account."}
        </p>
      </header>
      <LaneRule variant="arrows" />
      <div className="section-block form-grid">
        <p>
          <strong>{isGuest ? "Guest" : user?.email || "Signed in"}</strong>
        </p>
        {isGuest ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() => router.push("/login")}
          >
            Sign in / Create account
          </button>
        ) : (
          <button
            type="button"
            className="button-secondary"
            onClick={handleSignOut}
            disabled={busy}
          >
            {busy ? "Signing out..." : "Sign out"}
          </button>
        )}
        {error ? <p className="helper error-text">{error}</p> : null}
      </div>
    </section>
  );
}
