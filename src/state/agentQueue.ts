import {
  handleCommand,
  type Ack,
  type BridgeDeps,
  type PendingAck,
  type Proposal,
} from "./agentCommands";

type Release = () => void;

/**
 * Runs the relayed commands one at a time, so the next one's stale check sees
 * the previous one's result (datatoolkit-issues#63). A review does not hold
 * the line (datatoolkit-issues#97): the reviewed command shows its banner,
 * sends the interim ack `{id, pending: "review"}` (the agent's call returns at
 * once), and hands its turn over while the banner is open. View commands
 * (open_window, select_columns, set_view, ...) run meanwhile; another
 * `propose_steps` answers `busy`. On Apply / Dismiss the command queues again
 * and sends its final ack (`ok` / `rejected` / `stale` / `save_failed`).
 *
 * `show` puts the proposal on screen (synchronously, so `reviewPending` is
 * true before the next command runs) and resolves on the user's answer.
 */
export function commandRunner(
  deps: Omit<BridgeDeps, "review">,
  show: (proposal: Proposal) => Promise<boolean>,
  post: (ack: Ack | PendingAck) => Promise<void>,
): (raw: unknown) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  const turn = (): Promise<Release> => {
    let release!: Release;
    const done = new Promise<void>((resolve) => (release = resolve));
    const ready = tail.then(() => release);
    tail = tail.then(() => done);
    return ready;
  };

  return async (raw) => {
    const slot = { release: await turn() };
    const review = async (proposal: Proposal): Promise<boolean> => {
      const answer = show(proposal);
      await post({ id: proposal.id, pending: "review" });
      slot.release();
      const apply = await answer;
      slot.release = await turn();
      return apply;
    };
    try {
      const ack = await handleCommand(raw, { ...deps, review });
      if (ack) await post(ack);
    } finally {
      slot.release();
    }
  };
}
