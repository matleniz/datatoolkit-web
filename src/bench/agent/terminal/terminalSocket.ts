import { closeReason, encodeResize, parseControl, type ServerControl } from "./terminalProtocol";

/** `connecting` → `open` → `ended` (the CLI exited) | `dropped` (socket lost) | `closed` (by us). */
export type TerminalState = "connecting" | "open" | "ended" | "dropped" | "closed";

export interface TerminalSocketEvents {
  onState(state: TerminalState, detail?: { code?: number | null; message?: string }): void;
  onStarted(pack: string | null): void;
  /** Raw PTY bytes, to write to xterm as-is. */
  onOutput(data: Uint8Array): void;
}

type WebSocketLike = Pick<WebSocket, "close" | "readyState"> & {
  send(data: string | Uint8Array): void;
  binaryType: BinaryType;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
};

const OPEN = 1;

/** One PTY session over one WebSocket; closing it ends the session. */
export class TerminalSocket {
  private ws: WebSocketLike;
  private done = false;
  private encoder = new TextEncoder();
  private lastSize: { cols: number; rows: number } | null = null;

  constructor(
    url: string,
    private events: TerminalSocketEvents,
    make: (url: string) => WebSocketLike = (u) => new WebSocket(u),
  ) {
    this.ws = make(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      if (this.done) return;
      this.events.onState("open");
      // The size sent before the socket opened.
      if (this.lastSize) this.resize(this.lastSize.cols, this.lastSize.rows);
    };
    this.ws.onmessage = (ev) => this.handle(ev.data);
    this.ws.onerror = () => {};
    this.ws.onclose = (ev) => {
      const message = closeReason(ev.code);
      this.finish("dropped", message ? { message } : undefined);
    };
    this.events.onState("connecting");
  }

  private finish(state: "ended" | "dropped" | "closed", detail?: { code?: number | null; message?: string }) {
    if (this.done) return;
    this.done = true;
    this.events.onState(state, detail);
  }

  private handle(data: unknown) {
    if (this.done) return;
    if (typeof data === "string") {
      this.control(parseControl(data));
    } else if (data instanceof ArrayBuffer) {
      this.events.onOutput(new Uint8Array(data));
    }
  }

  private control(c: ServerControl | null) {
    if (!c) return;
    if (c.type === "started") this.events.onStarted(c.pack);
    else if (c.type === "exit") this.finish("ended", { code: c.code });
    else this.finish("dropped", { message: c.message });
  }

  input(data: string): void {
    if (this.done || this.ws.readyState !== OPEN) return;
    this.ws.send(this.encoder.encode(data));
  }

  resize(cols: number, rows: number): void {
    this.lastSize = { cols, rows };
    if (this.done || this.ws.readyState !== OPEN) return;
    this.ws.send(encodeResize(cols, rows));
  }

  /** Closing the socket ends the PTY session engine-side. */
  close(): void {
    this.finish("closed");
    this.ws.onclose = null;
    this.ws.close();
  }
}
