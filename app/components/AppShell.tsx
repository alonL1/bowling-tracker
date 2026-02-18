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
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`nav-link${active ? " active" : ""}`}
      aria-label={label}
      aria-current={active ? "page" : undefined}
    >
      <span className="nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="nav-label">{label}</span>
    </Link>
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
            href="/"
            label="Overview"
            exact
            icon={
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
          <NavItem
            href="/log"
            label="Log"
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
            href="/games"
            label="Games"
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
