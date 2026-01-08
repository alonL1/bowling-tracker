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
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: payload.onlineError,
            variant: "error"
          },
          {
            role: "assistant",
            content: payload.offlineAnswer,
            variant: "offline",
            meta: payload.offlineMeta,
            note:
              payload.offlineNote ||
              "This response was done offline so it can't handle complex questions and may be wrong."
          }
        ]);
        setChatStatus("idle");
        return;
      }
      if (payload.answer) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: payload.answer, meta: payload.meta }
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

  const renderInlineBold = (text: string) => {
    const lines = text.split("\n");
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
          {showExamples ? "Hide examples" : "View more examples"}
        </button>
        {showExamples ? (
          <div className="examples">
            <p className="helper">Examples:</p>
            <ul>
              <li>What is my average score across games 1 to 3?</li>
              <li>How often do I strike on frame 9?</li>
              <li>List games with my highest score between Jan 7th and March 3rd?</li>
              <li>What is my average on games played after 7pm?</li>
              <li>How often do I strike or spare?</li>
              <li>List all of the games where I scored above 130</li>
              <li>On which frames do I strike most often?</li>
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
