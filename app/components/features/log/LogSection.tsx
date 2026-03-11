"use client";

import Link from "next/link";

export default function LogSection() {
  return (
    <section className="screen record-menu-screen">
      <header className="screen-header">
        <h1 className="screen-title">Record</h1>
      </header>

      <div className="record-menu-actions">
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

        <Link href="/log/add-multiple-sessions" className="record-option-card">
          <h2>Add Multiple Sessions</h2>
          <p>
            Select up to 100 images and they will automatically be sorted into sessions
            and recorded
          </p>
        </Link>

        <Link
          href="/log/add-existing-session"
          className="record-option-card record-option-card-compact"
        >
          <h2>Add to Existing Session</h2>
          <p>Add game(s) to an already existing session.</p>
        </Link>
      </div>
    </section>
  );
}
