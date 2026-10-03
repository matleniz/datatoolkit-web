import { describe, expect, it } from "vitest";

import { closeReason, encodeResize, parseControl, terminalUrl } from "./terminalProtocol";
import { TerminalSocket, type TerminalState } from "./terminalSocket";

class FakeWs {
  binaryType: BinaryType = "blob";
  readyState = 0;
  sent: (string | Uint8Array)[] = [];
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send(d: string | Uint8Array) {
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
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

function setup() {
  const ws = new FakeWs();
  const states: TerminalState[] = [];
  const details: ({ code?: number | null; message?: string } | undefined)[] = [];
  const out: string[] = [];
  const packs: (string | null)[] = [];
  const sock = new TerminalSocket(
    "ws://x/t",
    {
      onState: (s, d) => {
        states.push(s);
        details.push(d);
      },
      onStarted: (p) => packs.push(p),
      onOutput: (d) => out.push(new TextDecoder().decode(d)),
    },
    () => ws,
  );
  return { ws, sock, states, details, out, packs };
}

const dec = (d: string | Uint8Array) => (typeof d === "string" ? d : new TextDecoder().decode(d));

describe("terminalProtocol", () => {
  it("builds a ws(s) URL with the documented query", () => {
    const u = new URL(
      terminalUrl(
        { session: "s 1", token: "tok", pack: "claude-code", cols: 100, rows: 30, model: "sonnet" },
        "/api",
        "http://127.0.0.1:5175",
      ),
    );
    expect(u.protocol).toBe("ws:");
    expect(u.pathname).toBe("/api/ui/terminal");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      session: "s 1",
      token: "tok",
      pack: "claude-code",
      cols: "100",
      rows: "30",
      model: "sonnet",
    });
    expect(
      terminalUrl({ session: "s", token: "t", pack: "gemini", cols: 1, rows: 1 }, "https://e.x/api/", "https://app.x"),
    ).toMatch(/^wss:\/\/e\.x\/api\/ui\/terminal\?/);
  });
  it("frames resize as JSON", () => {
    expect(JSON.parse(encodeResize(80, 24))).toEqual({ type: "resize", cols: 80, rows: 24 });
  });
  it("parses controls and ignores junk", () => {
    expect(parseControl('{"type":"started","pack":"gemini","model":null,"command":["gemini"]}')).toEqual({
      type: "started",
      pack: "gemini",
      model: null,
    });
    expect(parseControl('{"type":"exit","code":0}')).toEqual({ type: "exit", code: 0 });
    expect(parseControl('{"type":"exit"}')).toEqual({ type: "exit", code: null });
    expect(parseControl('{"type":"error","message":"spawn failed"}')).toEqual({ type: "error", message: "spawn failed" });
    expect(parseControl('{"type":"nope"}')).toBeNull();
    expect(parseControl("not json")).toBeNull();
    expect(parseControl("null")).toBeNull();
  });
  it("explains the documented refusal codes", () => {
    for (const c of [4401, 4403, 4404, 4409, 4422]) expect(closeReason(c)).toBeTruthy();
    expect(closeReason(1006)).toBeNull();
  });
});

describe("TerminalSocket", () => {
  it("opens, passes binary output through, drops text it does not know", () => {
    const { ws, states, out, packs } = setup();
    expect(states).toEqual(["connecting"]);
    expect(ws.binaryType).toBe("arraybuffer");
    ws.open();
    ws.msg('{"type":"started","pack":"gemini","model":null,"command":["gemini"]}');
    ws.msg(new TextEncoder().encode("hi \x1b[1mx").buffer);
    ws.msg("garbage");
    expect(states).toEqual(["connecting", "open"]);
    expect(packs).toEqual(["gemini"]);
    expect(out).toEqual(["hi \x1b[1mx"]);
  });

  it("sends keystrokes as binary and resize as text, only while open; replays the early size", () => {
    const { ws, sock } = setup();
    sock.resize(100, 30);
    sock.input("early");
    expect(ws.sent).toEqual([]);
    ws.open();
    expect(ws.sent.map(dec).map((s) => JSON.parse(s))).toEqual([{ type: "resize", cols: 100, rows: 30 }]);
    sock.input("é\r");
    sock.resize(90, 20);
    expect(ws.sent[1]).toBeInstanceOf(Uint8Array);
    expect(dec(ws.sent[1]!)).toBe("é\r");
    expect(JSON.parse(dec(ws.sent[2]!))).toEqual({ type: "resize", cols: 90, rows: 20 });
  });

  it("an exit control ends the session; the close that follows does not override it", () => {
    const { ws, states } = setup();
    ws.open();
    ws.msg('{"type":"exit","code":2}');
    ws.drop(1000);
    expect(states).toEqual(["connecting", "open", "ended"]);
  });

  it("an error control or a refusal code is a dropped session with a message", () => {
    const a = setup();
    a.ws.open();
    a.ws.msg('{"type":"error","message":"spawn failed"}');
    expect(a.states.at(-1)).toBe("dropped");
    expect(a.details.at(-1)).toEqual({ message: "spawn failed" });
    const b = setup();
    b.ws.drop(4403);
    expect(b.states.at(-1)).toBe("dropped");
    expect(b.details.at(-1)?.message).toMatch(/refused/);
  });

  it("a lost socket is 'dropped'", () => {
    const { ws, states } = setup();
    ws.open();
    ws.drop(1006);
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
