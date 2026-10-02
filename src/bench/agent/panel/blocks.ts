/**
 * Assistant text -> plain paragraphs and fenced code blocks. No markdown
 * library (datatoolkit-issues#67): only ``` fences are structure; inline
 * `code` spans are split out by `inlineCode`. An unclosed fence (a message
 * still streaming) is a code block up to the end.
 */

export type Block =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string; code: string };

const FENCE = /^\s*```(\S*)\s*$/;

export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let buf: string[] = [];
  let code: { lang: string; lines: string[] } | null = null;
  const flushText = () => {
    const joined = buf.join("\n").trim();
    if (joined) blocks.push({ kind: "text", text: joined });
    buf = [];
  };
  for (const line of text.split("\n")) {
    const fence = FENCE.exec(line);
    if (code) {
      if (fence && fence[1] === "") {
        blocks.push({ kind: "code", lang: code.lang, code: code.lines.join("\n") });
        code = null;
      } else {
        code.lines.push(line);
      }
    } else if (fence) {
      flushText();
      code = { lang: fence[1] ?? "", lines: [] };
    } else {
      buf.push(line);
    }
  }
  if (code) blocks.push({ kind: "code", lang: code.lang, code: code.lines.join("\n") });
  else flushText();
  return blocks;
}

/** "use `median` here" -> ["use ", {code: "median"}, " here"]. */
export function inlineCode(text: string): (string | { code: string })[] {
  const parts: (string | { code: string })[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ code: m[1] ?? "" });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
