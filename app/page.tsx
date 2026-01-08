import Dashboard from "./components/Dashboard";

export default function Home() {
  return (
    <main className="container">
      <header className="hero">
        <div>
          <p className="eyebrow">Bowling Tracker</p>
          <h1>Turn scoreboard photos into clean stats.</h1>
          <p className="lede">
            Upload a single game photo, pick the player name on the sheet, and
            let Gemini extract the frames. Your image is deleted right after
            extraction.
          </p>
        </div>
        <div className="hero-card">
          <h2>Simple flow</h2>
          <ul className="steps">
            <li>
              <span>1</span>
              Upload a scoreboard photo and confirm the player name.
            </li>
            <li>
              <span>2</span>
              We queue a background job and extract frames with AI.
            </li>
            <li>
              <span>3</span>
              Confirm the results, then ask questions about your stats.
            </li>
          </ul>
        </div>
      </header>

      <Dashboard />
    </main>
  );
}
