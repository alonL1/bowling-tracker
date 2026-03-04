import LaneRule from "../../components/LaneRule";

export default function FriendsPage() {
  return (
    <section className="screen">
      <header className="screen-header">
        <h1 className="screen-title">Friends</h1>
        <p className="screen-subtitle">
          See how your bowling stacks up with your people.
        </p>
      </header>
      <LaneRule variant="arrows" />
      <div className="section-block">
        <p className="helper">Coming soon.</p>
      </div>
    </section>
  );
}
