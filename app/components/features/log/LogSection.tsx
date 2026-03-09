"use client";

import Link from "next/link";
import { useState } from "react";

export default function LogSection() {
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  return (
    <section className={`screen record-menu-screen${showMoreOptions ? " expanded" : ""}`}>
      <header className="screen-header">
        <h1 className="screen-title">Record</h1>
        <p className="screen-subtitle">
          Record new games and add them to your personal log.
        </p>
      </header>

      <div className={`record-menu-actions${showMoreOptions ? " expanded" : ""}`}>
        <Link href="/log/live" className="record-option-card">
          <h2>Start a Session</h2>
          <p>
            About to start your bowling session? Select this option to start
            recording it live!
          </p>
        </Link>

        <Link href="/log/upload-session" className="record-option-card">
          <h2>Upload a Session</h2>
          <p>
            Finished bowling for the day? Select this option to upload your
            scoreboard images and record your session!
          </p>
        </Link>

        <button
          type="button"
          className="record-more-toggle"
          aria-expanded={showMoreOptions}
          onClick={() => setShowMoreOptions((current) => !current)}
        >
          {showMoreOptions ? "Hide More Options" : "More Options"}
        </button>

        <div
          className={`record-extra-options${showMoreOptions ? " expanded" : ""}`}
          aria-hidden={!showMoreOptions}
        >
          <div className="record-extra-options-inner">
            <Link
              href="/log/add-existing-session"
              className="record-option-card record-option-card-compact"
            >
              <h2>Add Games to an Existing Session</h2>
            </Link>

            <Link href="/log/add-multiple-sessions" className="record-option-card">
              <h2>Add Multiple Sessions</h2>
              <p>
                Select up to 100 images and they will automatically be sorted
                into sessions and recorded
              </p>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
