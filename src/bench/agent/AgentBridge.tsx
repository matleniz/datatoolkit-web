import { useEffect, useMemo, useRef, useState } from "react";

import { apiClient, postUiAck, putUiContext, uiEventsUrl, uiToken } from "../../api/client";
import {
  handleCommand,
  type BridgeDeps,
  type Proposal,
} from "../../state/agentCommands";
import { ensureWorkspaceSaved, useAppDispatch, useAppState } from "../../state/AppStore";
import type { AppAction } from "../../state/reducer";
import { buildUiContext } from "../../state/uiContext";
import { effectiveVersion } from "../version";

const PUBLISH_DEBOUNCE_MS = 300;
const TOAST_MS = 12_000;
/** How long the "agent touched" highlight stays. */
const TOUCH_MS = 2_000;
/** Longest wait for the render after a dispatch (a no-op never renders). */
const RENDER_WAIT_MS = 2_000;

function newSessionId(): string {
  const key = "dtk-ui-session";
  const known = window.sessionStorage.getItem(key);
  if (known) return known;
  const id = crypto.randomUUID();
  window.sessionStorage.setItem(key, id);
  return id;
}

/**
 * Agent bridge (datatoolkit-issues#63): publishes the view context to the
 * engine and runs the commands it relays. Renders nothing when the page has no
 * `dtk-ui-token` meta (plain `npm run dev` without `DTK_UI_TOKEN`).
 */
export function AgentBridge() {
  const token = useMemo(uiToken, []);
  return token ? <ActiveBridge token={token} /> : null;
}

function ActiveBridge({ token }: { token: string }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const session = useMemo(newSessionId, []);
  const [reviews, setReviews] = useState<Proposal[]>([]);
  const [toast, setToast] = useState<{ summary: string; undo?: AppAction[] } | null>(null);
  const touchTimer = useRef<number | undefined>(undefined);

  const stateRef = useRef(state);
  const renderWaiters = useRef<(() => void)[]>([]);
  const answers = useRef(new Map<string, (apply: boolean) => void>());

  useEffect(() => {
    stateRef.current = state;
    renderWaiters.current.splice(0).forEach((resolve) => resolve());
  }, [state]);

  const {
    screen, workspace, role, viewVersion, selection, editor, dock, toolParams, distBy,
  } = state;
  const context = useMemo(
    () =>
      buildUiContext(
        { screen, workspace, role, viewVersion, selection, editor, dock, toolParams, distBy },
        session,
      ),
    [screen, workspace, role, viewVersion, selection, editor, dock, toolParams, distBy, session],
  );
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      putUiContext(token, context).catch(() => undefined);
    }, PUBLISH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [token, context]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const deps: BridgeDeps = {
      getState: () => stateRef.current,
      dispatch,
      settle: async () => {
        await new Promise<void>((resolve) => {
          renderWaiters.current.push(resolve);
          window.setTimeout(resolve, RENDER_WAIT_MS);
        });
        await ensureWorkspaceSaved(stateRef.current.workspace);
      },
      review: (proposal) =>
        new Promise<boolean>((resolve) => {
          answers.current.set(proposal.id, resolve);
          setReviews((list) => [...list, proposal]);
        }),
      announce: (summary, undo) => setToast({ summary, undo }),
      frameColumns: async () => {
        const { workspace: ws, role: r, viewVersion: v } = stateRef.current;
        if (!ws) throw new Error("no workspace open");
        const page = await apiClient.workspaceRows(ws, r, effectiveVersion(ws, v), 0, 1);
        return page.columns.map((c) => c.name);
      },
      keySchema: (keyId) => apiClient.keySchema(keyId),
      touch: (touched) => {
        const { columns = [], tools = [], steps = [] } = touched;
        if (columns.length + tools.length + steps.length === 0) return;
        const at = Date.now();
        dispatch({ type: "AGENT_TOUCH", touch: { columns, tools, steps, at } });
        window.clearTimeout(touchTimer.current);
        touchTimer.current = window.setTimeout(
          () => dispatch({ type: "AGENT_TOUCH_CLEAR", at }),
          TOUCH_MS,
        );
      },
    };
    // One command at a time: the next one's stale check sees the previous
    // one's result.
    let queue: Promise<void> = Promise.resolve();
    const run = (raw: unknown) => {
      queue = queue.then(async () => {
        const ack = await handleCommand(raw, deps);
        if (ack) await postUiAck(token, ack).catch(() => undefined);
      });
    };

    const source = new EventSource(uiEventsUrl(session, token));
    source.addEventListener("command", (ev) => {
      try {
        run(JSON.parse((ev as MessageEvent<string>).data));
      } catch {
        /* not JSON: nothing to ack without an id */
      }
    });
    // The engine forgets contexts on restart; EventSource reconnects by itself.
    source.addEventListener("open", () => {
      putUiContext(token, contextRef.current).catch(() => undefined);
    });
    const pending = answers.current;
    return () => {
      source.close();
      window.clearTimeout(touchTimer.current);
      pending.forEach((resolve) => resolve(false));
      pending.clear();
    };
  }, [dispatch, session, token]);

  const answer = (id: string, apply: boolean) => {
    answers.current.get(id)?.(apply);
    answers.current.delete(id);
    setReviews((list) => list.filter((p) => p.id !== id));
  };

  if (reviews.length === 0 && !toast) return null;
  return (
    <div className="agent-bridge">
      {reviews.map((p) => (
        <section key={p.id} className="agent-review" aria-label="Agent proposal">
          <strong>Agent proposes: {p.summary}</strong>
          <ul>
            {p.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <div className="agent-actions">
            <button type="button" className="btn-primary" onClick={() => answer(p.id, true)}>
              Apply
            </button>
            <button type="button" className="btn-secondary" onClick={() => answer(p.id, false)}>
              Dismiss
            </button>
          </div>
        </section>
      ))}
      {toast ? (
        <div className="agent-toast" role="status">
          <span>Agent: {toast.summary}</span>
          {toast.undo ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                toast.undo?.forEach(dispatch);
                setToast(null);
              }}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
