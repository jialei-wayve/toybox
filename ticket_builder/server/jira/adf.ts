/**
 * Atlassian Document Format (ADF) for Jira issue descriptions.
 *
 * Jira Cloud REST issue create/update validates `description` as ADF. In practice, wrapper nodes
 * `{ type: "strong", content: [...] }` are often rejected with errors like `invalid_input`, while
 * bold must be expressed as `{ type: "text", text: "...", marks: [{ type: "strong" }] }`.
 *
 * We accept a minimal markdown convention: `**bold**` → Jira-compatible marked text.
 */

type AdfInline = Record<string, unknown>;

function parseLineToInlineContent(line: string): AdfInline[] {
  const out: AdfInline[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      out.push({ type: "text", text: line.slice(last, m.index) });
    }
    const inner = (m[1] ?? "").trim();
    if (inner.length > 0) {
      out.push({
        type: "strong",
        content: [{ type: "text", text: inner }],
      });
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) {
    out.push({ type: "text", text: line.slice(last) });
  }
  if (out.length === 0) {
    out.push({ type: "text", text: line.length > 0 ? line : " " });
  }
  return out;
}

function sanitizeInline(nodes: AdfInline[]): AdfInline[] {
  const out: AdfInline[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const t = String((node as { text?: string }).text ?? "");
      if (t.length === 0) continue;
      out.push(node);
      continue;
    }
    if (node.type === "strong") {
      const raw = (node as { content?: AdfInline[] }).content ?? [];
      const inner = sanitizeInline(raw);
      if (inner.length === 0) continue;
      out.push({ type: "strong", content: inner });
      continue;
    }
    if (node.type === "hardBreak") {
      out.push(node);
      continue;
    }
    out.push(node);
  }
  return out;
}

/**
 * Jira-compatible bold: strong wrapper → text node + marks (API rejects many `strong` nodes).
 */
function strongWrappersToTextMarks(nodes: AdfInline[]): AdfInline[] {
  const out: AdfInline[] = [];
  for (const node of nodes) {
    if (node.type === "strong") {
      const inner = (node as { content?: AdfInline[] }).content ?? [];
      for (const c of inner) {
        if (c.type !== "text") continue;
        const t = String((c as { text?: string }).text ?? "");
        if (t.length === 0) continue;
        out.push({
          type: "text",
          text: t,
          marks: [{ type: "strong" }],
        });
      }
      continue;
    }
    out.push(node);
  }
  return out;
}

function trimHardBreakEdges(nodes: AdfInline[]): AdfInline[] {
  const out = [...nodes];
  while (out.length > 0 && out[0]?.type === "hardBreak") {
    out.shift();
  }
  while (out.length > 0 && out[out.length - 1]?.type === "hardBreak") {
    out.pop();
  }
  return out;
}

/**
 * Plain / markdown-light (`**bold**`) → ADF for Jira `fields.description`.
 */
export function plainTextToAdf(text: string): {
  type: "doc";
  version: 1;
  content: Array<Record<string, unknown>>;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: " " }] }],
    };
  }

  const blocks = trimmed.split(/\n\s*\n/);
  const content: Array<Record<string, unknown>> = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const paraContent: AdfInline[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        paraContent.push({ type: "hardBreak" });
      }
      const line = lines[i] ?? "";
      paraContent.push(...parseLineToInlineContent(line));
    }
    let inlines = trimHardBreakEdges(
      strongWrappersToTextMarks(sanitizeInline(paraContent))
    );
    if (inlines.length === 0) {
      inlines = [{ type: "text", text: " " }];
    }
    content.push({ type: "paragraph", content: inlines });
  }

  if (content.length === 0) {
    content.push({ type: "paragraph", content: [{ type: "text", text: " " }] });
  }

  return { type: "doc", version: 1, content };
}

/** Same as plainTextToAdf — explicit name for markdown-bold → Jira ADF. */
export function transformMarkdownBoldToJiraDescriptionAdf(text: string) {
  return plainTextToAdf(text);
}

function adfInlineToPlain(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node !== "object") return "";
  const n = node as {
    type?: string;
    text?: string;
    content?: unknown[];
    marks?: Array<{ type?: string }>;
  };
  if (n.type === "text") {
    let t = n.text ?? "";
    if (n.marks?.some((m) => m.type === "strong")) {
      t = `**${t}**`;
    }
    return t;
  }
  if (n.type === "hardBreak") return "\n";
  if (n.type === "strong" && Array.isArray(n.content)) {
    const inner = n.content.map(adfInlineToPlain).join("");
    return inner.length > 0 ? `**${inner}**` : "";
  }
  if (Array.isArray(n.content)) {
    return n.content.map(adfInlineToPlain).join("");
  }
  return "";
}

function adfNodeToPlain(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; content?: unknown[] };
  if (n.type === "paragraph" && Array.isArray(n.content)) {
    return n.content.map(adfInlineToPlain).join("");
  }
  if (Array.isArray(n.content)) {
    return n.content.map(adfNodeToPlain).join("");
  }
  return adfInlineToPlain(node);
}

/** Best-effort plain text (+ restored `**bold**` from marks) from Jira description ADF. */
export function adfDocumentToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const d = doc as { type?: string; content?: unknown[] };
  if (d.type !== "doc" || !Array.isArray(d.content)) return "";
  const parts: string[] = [];
  for (const block of d.content) {
    const t = adfNodeToPlain(block).replace(/\s+$/g, "");
    if (t.length > 0) parts.push(t);
  }
  return parts.join("\n\n").trim();
}
