"use client";

import { Icon } from "@iconify/react";
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
  const pathname = usePathname() ?? "";
  const { user, loading, error } = useAuth();
  const isChatPage = pathname === "/chat";
  const mainClassName = isChatPage ? "container container-chat" : "container";

  if (loading) {
    return (
      <main className="container loading-shell">
        <div className="loading-row loading-row-prominent">
          <span className="spinner spinner-muted spinner-large" aria-hidden="true" />
          <span className="helper helper-large">Loading account...</span>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="container loading-shell">
        <div className="loading-row loading-row-prominent">
          <span className="spinner spinner-muted spinner-large" aria-hidden="true" />
          <span className="helper helper-large">Starting guest session...</span>
        </div>
      </main>
    );
  }

  return (
    <main className={mainClassName}>
      <nav className="top-nav">
        <div className="nav-links">
          <NavItem
            href="/sessions"
            label="Sessions"
            icon={
              <Icon
                icon="material-symbols:menu-book-rounded"
                width="36"
                height="36"
                aria-hidden="true"
              />
            }
          />
          <NavItem
            href="/chat"
            label="Chat"
            icon={
              <Icon
                icon="mingcute:chat-3-ai-fill"
                width="36"
                height="36"
                aria-hidden="true"
              />
            }
          />
          <NavItem
            href="/log"
            label="Record"
            icon={
              <Icon
                icon="ic:baseline-add-circle"
                width="36"
                height="36"
                aria-hidden="true"
              />
            }
          />
          <NavItem
            href="/friends"
            label="Friends"
            icon={
              <Icon
                icon="fa-solid:user-friends"
                width="36"
                height="36"
                aria-hidden="true"
              />
            }
          />
          <NavItem
            href="/account"
            label="Account"
            icon={
              <Icon icon="mdi:account" width="36" height="36" aria-hidden="true" />
            }
          />
        </div>
      </nav>

      {error ? <p className="helper error-text">{error}</p> : null}
      {children}
    </main>
  );
}
