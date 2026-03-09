"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";

export default function LiveSessionSection() {
  const router = useRouter();

  return (
    <section className="screen record-upload-screen">
      <header className="screen-header">
        <button
          type="button"
          className="record-back-button"
          onClick={() => router.push("/log")}
        >
          <Icon
            icon="material-symbols:arrow-back-ios-new-rounded"
            className="record-back-icon"
            aria-hidden="true"
          />
          <span>Back</span>
        </button>
        <h1 className="screen-title">Live Session</h1>
      </header>
      <p className="screen-subtitle">Live sessions coming soon...</p>
    </section>
  );
}
