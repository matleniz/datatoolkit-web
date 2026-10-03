import { describe, expect, it } from "vitest";

import { encodeFrame, parseControl, terminalUrl } from "./terminalProtocol";
import { TerminalSocket, type TerminalState } from "./terminalSocket";

class FakeWs {
  binaryType: BinaryType = "blob";
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  msg(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

function setup() {
  const ws = new FakeWs();
  const states: TerminalState[] = [];
  const out: string[] = [];
  const packs: (string | null)[] = [];
  const sock = new TerminalSocket(
    "ws://x/t",
    {
      onState: (s) => states.push(s),
      onReady: (p) => packs.push(p),
      onOutput: (d) => out.push(new TextDecoder().decode(d)),
    },
    () => ws,
  );
  return { ws, sock, states, out, packs };
}

describe("terminalProtocol", () => {
  it("builds a ws(s) URL with session and token in the query", () => {
    expect(terminalUrl("s 1", "tok", "/api", "http://127.0.0.1:5175")).toBe(
      "ws://127.0.0.1:5175/api/ui/agent/terminal?session=s+1&token=tok",
    );
    expect(terminalUrl("s", "t", "https://e.x/api/", "https://app.x")).toMatch(
      /^wss:\/\/e\.x\/api\/ui\/agent\/terminal\?/,
    );
  });
  it("frames input and resize as JSON", () => {
    expect(JSON.parse(encodeFrame({ type: "input", data: "ls\r" }))).toEqual({ type: "input", data: "ls\r" });
    expect(JSON.parse(encodeFrame({ type: "resize", cols: 80, rows: 24 }))).toEqual({
      type: "resize",
      cols: 80,
      rows: 24,
    });
  });
  it("parses controls and ignores junk", () => {
    expect(parseControl('{"type":"ready","pack":"claude-code"}')).toEqual({ type: "ready", pack: "claude-code" });
    expect(parseControl('{"type":"exit","code":0}')).toEqual({ type: "exit", code: 0 });
    expect(parseControl('{"type":"exit"}')).toEqual({ type: "exit", code: null });
    expect(parseControl('{"type":"nope"}')).toBeNull();
    expect(parseControl("not json")).toBeNull();
    expect(parseControl("null")).toBeNull();
  });
});

describe("TerminalSocket", () => {
  it("opens, passes binary output through, drops text it does not know", () => {
    const { ws, states, out, packs } = setup();
    expect(states).toEqual(["connecting"]);
    expect(ws.binaryType).toBe("arraybuffer");
    ws.open();
    ws.msg('{"type":"ready","pack":"gemini"}');
    ws.msg(new TextEncoder().encode("hi \x1b[1mx").buffer);
    ws.msg("garbage");
    expect(states).toEqual(["connecting", "open"]);
    expect(packs).toEqual(["gemini"]);
    expect(out).toEqual(["hi \x1b[1mx"]);
  });

  it("sends input and resize only while open; replays the size queued before open", () => {
    const { ws, sock } = setup();
    sock.resize(100, 30);
    sock.input("early");
    expect(ws.sent).toEqual([]);
    ws.open();
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([{ type: "resize", cols: 100, rows: 30 }]);
    sock.input("a");
    sock.resize(90, 20);
    expect(ws.sent.map((s) => JSON.parse(s)).slice(1)).toEqual([
      { type: "input", data: "a" },
      { type: "resize", cols: 90, rows: 20 },
    ]);
  });

  it("an exit control ends the session; a socket loss afterwards does not override it", () => {
    const { ws, states } = setup();
    ws.open();
    ws.msg('{"type":"exit","code":2}');
    ws.drop();
    expect(states).toEqual(["connecting", "open", "ended"]);
  });

  it("a lost socket is 'dropped'", () => {
    const { ws, states } = setup();
    ws.open();
    ws.drop();
    expect(states.at(-1)).toBe("dropped");
  });

  it("close() closes the socket once and reports 'closed', not 'dropped'", () => {
    const { ws, sock, states } = setup();
    ws.open();
    sock.close();
    expect(ws.closed).toBe(true);
    expect(states.at(-1)).toBe("closed");
    sock.input("x");
    expect(ws.sent).toEqual([]);
  });
});
