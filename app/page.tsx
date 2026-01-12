import Dashboard from "./components/Dashboard";

export default function Home() {
  return (
    <main className="container">
      <nav className="top-nav">
        <div className="nav-links">
          <a href="#overview" className="nav-link" aria-label="Overview">
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="nav-label">Overview</span>
          </a>
          <a href="#submit" className="nav-link" aria-label="Log a Game">
            <span className="nav-icon" aria-hidden="true">
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
            </span>
            <span className="nav-label">Log a Game</span>
          </a>
          <a href="#games" className="nav-link" aria-label="Game Log">
            <span className="nav-icon" aria-hidden="true">
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
            </span>
            <span className="nav-label">Game Log</span>
          </a>
          <a href="#chat" className="nav-link" aria-label="Chat">
            <span className="nav-icon" aria-hidden="true">
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
            </span>
            <span className="nav-label">Chat</span>
          </a>
        </div>
      </nav>

      <header className="hero anchor-section" id="overview">
        <div>
          <p className="eyebrow">Bowling Tracker</p>
          <h1>Log your bowling and learn about your game.</h1>
          <p className="lede">
            Upload a scoreboard photo and let our AI extract the frames.
            Your image is deleted right after
            extraction.
          </p>
        </div>
        <div className="hero-card">
          <h2>The flow</h2>
          <ul className="steps">
            <li>
              <span>1</span>
              Upload a scoreboard photo and enter your name the way it appears.
            </li>
            <li>
              <span>2</span>
              Confirm the results, then ask questions about your stats.
            </li>
            <li>
              <span>3</span>
              Add more games to your log at any time.
            </li>
          </ul>
        </div>
      </header>

      <Dashboard />
    </main>
  );
}
