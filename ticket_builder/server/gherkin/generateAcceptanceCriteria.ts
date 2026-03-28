/**
 * Exactly three acceptance criteria in Gherkin-informed prose.
 * Only Gherkin keywords/phrases are wrapped in **bold** (markdown); ADF conversion maps to Jira.
 */

export interface AcceptanceCriteriaInput {
  rawText: string;
  gherkin: string;
}

function plainForEmbedding(s: string): string {
  return s.replace(/\*\*/g, "");
}

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

interface ParsedContext {
  rawFirstLine: string;
  detailTail: string;
  featureTitle: string;
  scenarioTitle: string;
  iWant: string;
  soThat: string;
  givenClause: string;
}

function parseContext(rawText: string, gherkin: string): ParsedContext {
  const raw = rawText.trim();
  const rawLines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const rawFirstLine = plainForEmbedding(clip(rawLines[0] ?? raw, 200));
  const detailTail = plainForEmbedding(
    clip(collapseWs(rawLines.slice(1).join(" ")), 280)
  );

  const lines = gherkin.split(/\r?\n/).map((l) => l.trim());
  let featureTitle = rawFirstLine;
  let scenarioTitle = "";
  let iWant = "";
  let soThat = "";
  let givenClause = "";

  for (const line of lines) {
    const fm = /^Feature:\s*(.+)$/i.exec(line);
    if (fm) featureTitle = plainForEmbedding(clip(fm[1].trim(), 200));
    const sm = /^Scenario:\s*(.+)$/i.exec(line);
    if (sm) scenarioTitle = plainForEmbedding(clip(sm[1].trim(), 160));
    const iw = /^\*\*I want\*\*\s+(.+)$/i.exec(line);
    if (iw) iWant = plainForEmbedding(clip(iw[1].trim(), 320));
    const st = /^\*\*So that\*\*\s+(.+)$/i.exec(line);
    if (st) soThat = plainForEmbedding(clip(st[1].trim(), 320));
    const gv = /^\*\*Given\*\*\s+(.+)$/i.exec(line);
    if (gv) givenClause = plainForEmbedding(clip(gv[1].trim(), 280));
  }

  return {
    rawFirstLine,
    detailTail,
    featureTitle,
    scenarioTitle,
    iWant,
    soThat,
    givenClause,
  };
}

/**
 * Produces exactly three paragraphs. Only **Given**, **When**, **Then**, **And**, **But**,
 * **As a**, **I want**, **So that** appear bolded (as markdown).
 */
export function generateAcceptanceCriteria(input: AcceptanceCriteriaInput): string[] {
  const raw = input.rawText.trim();
  const gherkin = input.gherkin.trim();
  if (!raw || !gherkin) {
    throw new Error("Both raw requirement text and Gherkin are required for acceptance criteria");
  }

  const c = parseContext(raw, gherkin);
  const primaryLabel = c.scenarioTitle || c.featureTitle || c.rawFirstLine;
  const wantSnippet = c.iWant || c.detailTail || c.rawFirstLine;
  const given =
    c.givenClause ||
    (c.detailTail.length > 12
      ? c.detailTail
      : "the preconditions implied by the requirement are in place");

  const ac1 =
    `**Given** ${given}, **When** the user follows the main flow for "${primaryLabel}", **Then** the product behaviour matches ${clip(wantSnippet, 240)} **And** the result can be verified through the UI or connected systems.`;

  const invalidTrigger =
    c.detailTail.length > 16
      ? `required data from "${clip(c.rawFirstLine, 80)}" is absent or invalid`
      : "required inputs are absent or invalid";

  const ac2 =
    `**Given** ${given} **But** ${invalidTrigger}, **When** the user attempts the same flow, **Then** the system rejects the action safely **And** presents a clear, actionable message **And** does not leave inconsistent persisted state.`;

  const benefit = c.soThat || c.detailTail || "the described need is satisfied without regressions";
  const ac3 =
    `**As a** reviewer validating this story, **I want** ${clip(`traceable proof that ${benefit}`, 220)}, **So that** we only accept work that matches the agreed scope. **When** checks for "${primaryLabel}" are run, **Then** they pass **But** behaviour outside this story remains unchanged.`;

  return [ac1, ac2, ac3].map((p) => p.replace(/\s+/g, " ").trim());
}
