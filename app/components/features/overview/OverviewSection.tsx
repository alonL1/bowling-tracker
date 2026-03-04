import LaneRule from "../../LaneRule";

export default function OverviewSection() {
  return (
    <section className="screen">
      <header className="screen-header">
        <p className="eyebrow">Bowling Tracker</p>
        <h1 className="screen-title">Log your bowling and learn about your game.</h1>
        <p className="screen-subtitle">
          Upload a scoreboard photo and let our AI extract the frames. Your
          image is deleted right after extraction.
        </p>
      </header>
      <LaneRule variant="arrows" />
      <div className="hero-flow">
        <div className="section-block intro-flow">
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
      </div>
    </section>
  );
}
