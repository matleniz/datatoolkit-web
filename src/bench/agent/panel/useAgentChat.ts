import { useCallback, useEffect, useReducer, useState } from "react";

import { uiEventsUrl } from "../../../api/client";
import {
  AgentHttpError,
  cancelAgent,
  getAgentStatus,
  getCommandStatus,
  replyPermission,
  sendAgentMessage,
} from "./agentClient";
import { parseAgentEvent, type AgentStatus } from "./protocol";
import {
  EMPTY_TRANSCRIPT,
  reviewCommands,
  transcriptReducer,
  type Transcript,
} from "./transcript";

/** How often a chip waiting for the user's review asks the engine for the outcome. */
const REVIEW_POLL_MS = 1_500;

/** Same per-tab id as the AgentBridge context, so the agent sees this tab. */
export function uiSession(): string {
  const key = "dtk-ui-session";
  const known = window.sessionStorage.getItem(key);
  if (known) return known;
  const id = crypto.randomUUID();
  window.sessionStorage.setItem(key, id);
  return id;
}

type AgentLink =
  | { state: "loading" }
  | { state: "ready"; status: AgentStatus }
  | { state: "unreachable"; message: string };

export interface AgentChat {
  link: AgentLink;
  transcript: Transcript;
  send(text: string, attachments?: string[]): void;
  stop(): void;
  reply(id: string, allow: boolean): void;
  refresh(): void;
  clear(): void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * One chat with the engine's agent pack (datatoolkit-issues#67): the status,
 * the transcript folded from `event: agent` on the UI bridge SSE stream, and
 * the POST actions. A second `EventSource` on the same session is fine: the
 * bridge fans every message out to all of a session's listeners.
 */
export function useAgentChat(token: string): AgentChat {
  const [session] = useState(uiSession);
  const [transcript, dispatch] = useReducer(transcriptReducer, EMPTY_TRANSCRIPT);
  const [link, setLink] = useState<AgentLink>({ state: "loading" });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    getAgentStatus(token)
      .then((status) => {
        if (!live) return;
        setLink({ state: "ready", status });
        if (status.usage) dispatch({ type: "usage_seed", usage: status.usage });
      })
      .catch((err: unknown) => {
        if (live) setLink({ state: "unreachable", message: message(err) });
      });
    return () => {
      live = false;
    };
  }, [token, tick]);

  useEffect(() => {
    const source = new EventSource(uiEventsUrl(session, token));
    source.addEventListener("agent", (ev) => {
      let event;
      try {
        event = parseAgentEvent(JSON.parse((ev as MessageEvent<string>).data));
      } catch {
        return;
      }
      if (event) dispatch({ type: "event", event });
    });
    return () => source.close();
  }, [session, token]);

  // A reviewed command ends after the turn (Apply / Dismiss in Studio): the
  // engine's command status is what the agent sees, so the chip follows it.
  const waiting = reviewCommands(transcript).join(" ");
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      for (const command of waiting.split(" ")) {
        getCommandStatus(token, command)
          .then((s) => s && dispatch({ type: "command_status", command, ...s }))
          .catch(() => undefined);
      }
    }, REVIEW_POLL_MS);
    return () => window.clearInterval(timer);
  }, [token, waiting]);

  const send = useCallback(
    (text: string, attachments?: string[]) => {
      dispatch({ type: "sent", text });
      sendAgentMessage(token, session, text, attachments).catch((err: unknown) => {
        dispatch({ type: "local_error", message: message(err) });
        if (err instanceof AgentHttpError && err.kind === "NoAgent") refresh();
      });
    },
    [token, session, refresh],
  );

  const stop = useCallback(() => {
    cancelAgent(token, session).catch((err: unknown) =>
      dispatch({ type: "local_error", message: message(err) }),
    );
  }, [token, session]);

  const reply = useCallback(
    (id: string, allow: boolean) => {
      dispatch({ type: "reply", id, allow });
      replyPermission(token, session, id, allow).catch((err: unknown) =>
        dispatch({ type: "local_error", message: message(err) }),
      );
    },
    [token, session],
  );

  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  return { link, transcript, send, stop, reply, refresh, clear };
}
