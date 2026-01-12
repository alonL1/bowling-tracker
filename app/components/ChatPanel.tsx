"use client";

import { useEffect, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
  variant?: "error" | "offline";
  note?: string;
  meta?: string;
};

type ChatPanelProps = {
  gameId?: string | null;
  gameLabel?: string;
};

export default function ChatPanel({ gameId, gameLabel }: ChatPanelProps) {
  const [question, setQuestion] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Ask me about your scores, strikes, or patterns."
    }
  ]);
  const [chatStatus, setChatStatus] = useState<"idle" | "loading" | "error">(
    "idle"
  );
  const [showExamples, setShowExamples] = useState<boolean>(false);

  useEffect(() => {
    setMessages([
      {
        role: "assistant",
        content: "Ask me about your scores, strikes, or patterns."
      }
    ]);
    setQuestion("");
    setChatStatus("idle");
  }, [gameId]);

  const handleAsk = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!question.trim()) {
      return;
    }

    const userQuestion = question.trim();
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", content: userQuestion }]);
    setChatStatus("loading");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userQuestion,
          gameId,
          timezoneOffsetMinutes: new Date().getTimezoneOffset()
        })
      });

      if (!response.ok) {
        const errorPayload = (await response.json()) as { error?: string };
        throw new Error(errorPayload.error || "Chat request failed.");
      }

      const payload = (await response.json()) as {
        answer?: string;
        meta?: string;
        onlineError?: string;
        offlineAnswer?: string;
        offlineMeta?: string;
        offlineNote?: string;
      };
      if (payload.onlineError && payload.offlineAnswer) {
        const onlineError = payload.onlineError ?? "Chat request failed.";
        const offlineAnswer = payload.offlineAnswer ?? "Offline answer unavailable.";
        const offlineNote =
          payload.offlineNote ||
          "This response was done offline so it can't handle complex questions and may be wrong.";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: onlineError,
            variant: "error"
          },
          {
            role: "assistant",
            content: offlineAnswer,
            variant: "offline",
            meta: payload.offlineMeta,
            note: offlineNote
          }
        ]);
        setChatStatus("idle");
        return;
      }
      if (payload.answer) {
        const answer = payload.answer ?? "No response returned.";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: answer, meta: payload.meta }
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "No response returned."
          }
        ]);
      }
      setChatStatus("idle");
    } catch (error) {
      setChatStatus("error");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            error instanceof Error ? error.message : "Chat request failed.",
          variant: "error"
        }
      ]);
    }
  };

  const formatDatesInText = (text: string) => {
    const dateTimeRegex =
      /\b(\d{4}-\d{2}-\d{2})(?:\s+at\s+|\s+|T)(\d{2}:\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?\b/g;
    const dateOnlyRegex = /\b(\d{4}-\d{2}-\d{2})\b(?![T\s]\d{2}:\d{2})/g;
    const timeOnlyRegex = /\b([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))\b/g;
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    });
    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });

    const withDateTimes = text.replace(
      dateTimeRegex,
      (match, datePart, timePart, tzPart) => {
        const iso = `${datePart}T${timePart}${tzPart || ""}`;
        const parsed = new Date(iso);
        if (Number.isNaN(parsed.getTime())) {
          return match;
        }
        return `${dateFormatter.format(parsed)} ${timeFormatter.format(parsed)}`;
      }
    );

    const withDates = withDateTimes.replace(dateOnlyRegex, (match, datePart) => {
      const parsed = new Date(`${datePart}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) {
        return match;
      }
      return dateFormatter.format(parsed);
    });
    return withDates.replace(timeOnlyRegex, (match, hour, minute, second) => {
      const iso = `1970-01-01T${hour}:${minute}:${second || "00"}`;
      const parsed = new Date(iso);
      if (Number.isNaN(parsed.getTime())) {
        return match;
      }
      return timeFormatter.format(parsed);
    });
  };

  const renderInlineBold = (text: string) => {
    const lines = formatDatesInText(text).split("\n");
    const nodes: JSX.Element[] = [];
    let listBuffer: JSX.Element[] = [];

    const flushList = () => {
      if (listBuffer.length === 0) {
        return;
      }
      nodes.push(
        <ul key={`list-${nodes.length}`} className="chat-list">
          {listBuffer}
        </ul>
      );
      listBuffer = [];
    };

    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim();
      const bulletMatch = trimmed.match(/^(\*|-)\s+(.*)$/);
      const parts = (bulletMatch ? bulletMatch[2] : line).split("**");
      const content = parts.map((part, index) =>
        index % 2 === 1 ? (
          <strong key={`b-${lineIndex}-${index}`}>{part}</strong>
        ) : (
          part
        )
      );

      if (bulletMatch) {
        listBuffer.push(
          <li key={`li-${lineIndex}`}>
            {content}
          </li>
        );
        return;
      }

      flushList();
      if (lineIndex === lines.length - 1) {
        nodes.push(<span key={`l-${lineIndex}`}>{content}</span>);
      } else {
        nodes.push(
          <span key={`l-${lineIndex}`}>
            {content}
            <br />
          </span>
        );
      }
    });

    flushList();
    return nodes;
  };

  return (
    <div className="chat-section">
      <div className="panel-header">
        <h2>Ask about your stats</h2>
        <p className="helper">
          Ask anything about your bowling stats.
        </p>
        <button
          type="button"
          className="text-button"
          onClick={() => setShowExamples((prev) => !prev)}
        >
          {showExamples ? "Hide examples" : "View examples"}
        </button>
        {showExamples ? (
          <div className="examples">
            <p className="helper">Examples:</p>
            <ul>
              <li>What is my <b>average score</b> across <b>games 1 to 3</b>?</li>
              <li>How often do I <b>strike</b> on <b>frame 9</b>?</li>
              <li>List games with my <b>highest score</b> between <b>Jan 7th</b> and <b>March 3rd</b>?</li>
              <li>What is my <b>average</b> on games played <b>after 7pm</b>?</li>
              <li>How often do I <b>strike</b> or <b>spare</b>?</li>
              <li>List all of the games where I <b>scored above 130</b>?</li>
              <li>What <b>percent</b> of the time do I bowl a <b>7</b> in a frame?</li>
              <li>Of the times that I bowl a <b>7</b> how often do I <b>convert the spare</b>?</li>
              <li>On average, what are my <b>top 3</b> best <b>frames</b>?</li>
              <li>On which <b>frames</b> do I <b>strike most often</b>?</li>
              <li>How often do I <b>10 pin spare</b>?</li>
              <li>Whats my <b>average</b> since the <b>new pope</b> was elected?</li>
              <li>Am I <b>better after 5pm</b> or <b>before</b>?</li>
              <li>Give me <b>coaching tips</b> based on my <b>last 5 games</b>.</li>
              <li>What should I focus on to <b>improve my spare conversion</b>?</li>
              <li>Try anything you want! Feel free to get <b>creative</b> with it!</li>
            </ul>
          </div>
        ) : null}
      </div>
      <div className="chat-messages">
        {messages.map((message, index) => {
          const next = messages[index + 1];
          const isLast =
            message.role === "assistant" &&
            (!next || next.role === "user");
          return (
            <div
              key={`${message.role}-${index}`}
              className={`message ${message.role} ${message.variant || ""} ${isLast ? "group-end" : ""}`}
            >
              {message.meta ? (
                <div className="message-meta">{message.meta}</div>
              ) : null}
              <div>{renderInlineBold(message.content)}</div>
              {message.note ? (
                <div className="offline-note">
                  {renderInlineBold(message.note)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <form className="chat-form" onSubmit={handleAsk}>
        <textarea
          className="chat-input"
          placeholder="Ask: What's my strike rate on frame 9?"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={3}
        />
        <button type="submit" disabled={chatStatus === "loading"}>
          <span className="button-content">
            {chatStatus === "loading" ? (
              <span className="spinner" aria-hidden="true" />
            ) : null}
            {chatStatus === "loading" ? "Thinking..." : "Ask Bowling AI"}
          </span>
        </button>
      </form>
    </div>
  );
}
