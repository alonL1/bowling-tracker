export default function OverviewSection() {
  return (
    <header className="hero">
      <div>
        <p className="eyebrow">Bowling Tracker</p>
        <h1>Log your bowling and learn about your game.</h1>
        <p className="lede">
          Upload a scoreboard photo and let our AI extract the frames.
          Your image is deleted right after extraction.
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
  );
}
