import { useCallback, useEffect, useReducer, useState } from "react";

import { UiHttpError, uiEventsUrl, uiSession } from "../../../api/client";
import { detachAttachment, listAttachments } from "../attachments/attachmentContract";
import {
  cancelAgent,
  getAgentOptions,
  getAgentStatus,
  getCommandStatus,
  replyPermission,
  sendAgentMessage,
  setAgentConfig,
} from "./agentClient";
import { parseAgentEvent, type AgentOptions, type AgentStatus } from "./protocol";
import {
  EMPTY_TRANSCRIPT,
  reviewCommands,
  transcriptReducer,
  type Transcript,
} from "./transcript";

/** How often a chip waiting for the user's review asks the engine for the outcome. */
const REVIEW_POLL_MS = 1_500;

type AgentLink =
  | { state: "loading" }
  | { state: "ready"; status: AgentStatus; options: AgentOptions | null }
  | { state: "unreachable"; message: string };

export interface AgentChat {
  link: AgentLink;
  transcript: Transcript;
  send(text: string, attachments?: string[]): void;
  stop(): void;
  reply(id: string, allow: boolean): void;
  refresh(): void;
  clear(): void;
  /** Detach one of the session's attachments (`transcript.attached`). */
  detach(id: string): void;
  /** Pick this session's pack / model; the error text is in `configError`. */
  configure(pack: string, model: string | null): void;
  configError: string | null;
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
  const [configError, setConfigError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    // An engine without the options route (or a failing one) = no selector.
    const options = getAgentOptions(token).catch(() => null);
    Promise.all([getAgentStatus(token, session), options])
      .then(([status, opts]) => {
        if (!live) return;
        setLink({ state: "ready", status, options: opts });
        if (status.usage) dispatch({ type: "usage_seed", usage: status.usage });
      })
      .catch((err: unknown) => {
        if (live) setLink({ state: "unreachable", message: message(err) });
      });
    // Attachments outlive the panel and earlier turns: start from the engine's list.
    listAttachments(token, session)
      .then((attached) => live && dispatch({ type: "attachments_seed", attached }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token, session, tick]);

  useEffect(() => {
    const source = new EventSource(uiEventsUrl(session, token));
    source.addEventListener("agent", (ev) => {
      let event;
      try {
        event = parseAgentEvent(JSON.parse((ev as MessageEvent<string>).data));
      } catch {
        return;
      }
      if (!event) return;
      dispatch({ type: "event", event });
      if (event.type === "config") refresh();
    });
    return () => source.close();
  }, [session, token, refresh]);

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
        if (err instanceof UiHttpError && err.kind === "NoAgent") refresh();
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

  const configure = useCallback(
    (pack: string, model: string | null) => {
      setConfigError(null);
      setAgentConfig(token, session, pack, model)
        .then((status) =>
          setLink((l) => (l.state === "ready" ? { ...l, status } : l)),
        )
        .catch((err: unknown) => setConfigError(message(err)));
    },
    [token, session],
  );

  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  const detach = useCallback(
    (id: string) => {
      detachAttachment(token, session, id)
        // The engine also emits `attachment_removed`; this covers a missed event.
        .then(() => dispatch({ type: "event", event: { type: "attachment_removed", id } }))
        .catch((err: unknown) => dispatch({ type: "local_error", message: message(err) }));
    },
    [token, session],
  );

  return { link, transcript, send, stop, reply, refresh, clear, detach, configure, configError };
}
