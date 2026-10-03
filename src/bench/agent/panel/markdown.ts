import DOMPurify from "dompurify";
import { Marked } from "marked";

/**
 * Assistant text -> sanitised HTML (datatoolkit-issues#112). Column names and
 * cell values reach the model, so its reply is untrusted: raw HTML in the
 * source is shown as text, images become their alt text, links keep only
 * http(s), and the result goes through DOMPurify with a tag allow-list.
 * An unclosed fence (a message still streaming) renders as an open code block.
 */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => escapeHtml(text),
  },
});

const ALLOWED_TAGS = [
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
  "blockquote", "pre", "code", "em", "strong", "del", "a", "table", "thead",
  "tbody", "tr", "th", "td", "input",
];
const ALLOWED_ATTR = ["href", "class", "align", "start", "type", "checked", "disabled"];
const SAFE_HREF = /^https?:\/\//i;

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (!SAFE_HREF.test(href)) {
      // Not a web link (javascript:, data:, relative...): keep the text only.
      node.replaceWith(...Array.from(node.childNodes));
      return;
    }
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  // Task-list checkboxes are the only <input> kept, and never interactive.
  if (node.nodeName === "INPUT") {
    if (node.getAttribute("type") !== "checkbox") node.remove();
    else node.setAttribute("disabled", "");
  }
});

export function renderMarkdown(text: string): string {
  const html = marked.parse(text) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_HREF,
    ALLOW_DATA_ATTR: false,
  });
}
