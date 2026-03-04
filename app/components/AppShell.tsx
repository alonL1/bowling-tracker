"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./providers/AuthProvider";

function NavItem({
  href,
  label,
  icon,
  exact = false
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const currentPathname = pathname ?? "";
  const active = exact
    ? currentPathname === href
    : currentPathname.startsWith(href);
  return (
    <div className={`nav-item${active ? " active" : ""}`}>
      <Link
        href={href}
        className={`nav-link${active ? " active" : ""}`}
        aria-label={label}
        aria-current={active ? "page" : undefined}
      >
        <span className="nav-icon" aria-hidden="true">
          {icon}
        </span>
      </Link>
      <span className="nav-label" aria-hidden={!active}>
        {label}
      </span>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, error } = useAuth();

  if (loading) {
    return (
      <main className="container">
        <div className="loading-row">
          <span className="spinner spinner-muted" aria-hidden="true" />
          <span className="helper">Loading account...</span>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="container">
        <div className="loading-row">
          <span className="spinner spinner-muted" aria-hidden="true" />
          <span className="helper">Starting guest session...</span>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <nav className="top-nav">
        <div className="nav-links">
          <NavItem
            href="/sessions"
            label="Sessions"
            icon={
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path
                  d="M6 4h9l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 11h8M8 15h8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            }
          />
          <NavItem
            href="/chat"
            label="Chat"
            icon={
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path
                  d="M5 6h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 11h8M8 14h5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            }
          />
          <NavItem
            href="/log"
            label="Record"
            icon={
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path
                  d="M12 4v10m0-10 4 4m-4-4-4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
          <NavItem
            href="/friends"
            label="Friends"
            icon={
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path
                  d="M8.5 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm7 0a2.5 2.5 0 1 0-2.5-2.5A2.5 2.5 0 0 0 15.5 11zM3.5 19a5 5 0 0 1 10 0m-1 0a4 4 0 0 1 8 0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
          <NavItem
            href="/account"
            label="Account"
            icon={
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path
                  d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7 8a7 7 0 0 1 14 0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
        </div>
      </nav>

      {error ? <p className="helper error-text">{error}</p> : null}
      {children}
    </main>
  );
}
