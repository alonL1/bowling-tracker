import LaneRule from "../../LaneRule";
import ChatPanel from "../../ChatPanel";

export default function ChatSection() {
  return (
    <section className="screen">
      <header className="screen-header">
        <h1 className="screen-title">Chat</h1>
        <p className="screen-subtitle">
          Ask about your bowling stats, patterns, sessions, and trends. <br />
          Chats can be about anything, get creative or checkout our examples.
        </p>
      </header>
      <LaneRule variant="arrows" />
      <div className="section-block">
        <ChatPanel gameLabel="all games" />
      </div>
    </section>
  );
}
